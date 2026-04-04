const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const MAX_TOTAL_UPLOAD_BYTES = 20 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpg',
  'image/jpeg',
  'image/webp'
]);

function buildSourceSummary(normalizedSources, prompt) {
  const fileSources = normalizedSources.filter((source) => source.type === 'pdf' || source.type === 'image');
  const pdfPages = fileSources.filter((source) => source.type === 'pdf').length;
  const imageCount = fileSources.filter((source) => source.type === 'image').length;
  const extractedChars = fileSources.reduce((acc, source) => acc + ((source.rawText || '').length), 0);

  return {
    promptIncluded: Boolean(prompt),
    totalSources: normalizedSources.length,
    fileSourceCount: fileSources.length,
    pdfPages,
    imageCount,
    extractedChars
  };
}

function inferInputMode(prompt, sources) {
  const hasPrompt = Boolean(prompt);
  const hasPdf = sources.some((source) => source.type === 'pdf' || source.mimetype === 'application/pdf');
  const hasImage = sources.some((source) => source.type === 'image' || (source.mimetype || '').startsWith('image/'));

  if (hasPrompt && (hasPdf || hasImage)) return 'mixed';
  if (!hasPrompt && hasPdf && hasImage) return 'file_only_mixed';
  if (!hasPrompt && hasPdf) return 'pdf_only';
  if (!hasPrompt && hasImage) return 'image_only';
  return 'text_only';
}

function validateFiles(files) {
  if (!Array.isArray(files) || files.length === 0) {
    return;
  }

  const totalBytes = files.reduce((acc, file) => acc + (file.size || 0), 0);
  if (totalBytes > MAX_TOTAL_UPLOAD_BYTES) {
    const err = new Error('Total upload size exceeds 20 MB.');
    err.status = 413;
    throw err;
  }

  for (const file of files) {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      const err = new Error(`Unsupported file type: ${file.mimetype || 'unknown'}.`);
      err.status = 400;
      throw err;
    }
  }

  const pdfFiles = files.filter((file) => file.mimetype === 'application/pdf');
  const imageFiles = files.filter((file) => file.mimetype.startsWith('image/'));
  const mixedTypes = pdfFiles.length > 0 && imageFiles.length > 0;

  if (mixedTypes) {
    const err = new Error('Upload either 1 PDF or up to 5 images, not both.');
    err.status = 400;
    throw err;
  }

  if (pdfFiles.length > 1) {
    const err = new Error('Only 1 PDF is allowed per request.');
    err.status = 400;
    throw err;
  }

  if (imageFiles.length > 5) {
    const err = new Error('A maximum of 5 images is allowed per request.');
    err.status = 400;
    throw err;
  }

  if (pdfFiles.length === 0 && imageFiles.length === 0) {
    const err = new Error('No supported files were provided.');
    err.status = 400;
    throw err;
  }
}

function tryRunPython(command, args, cwd) {
  return spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    timeout: 120000,
    maxBuffer: 10 * 1024 * 1024
  });
}

function runPythonExtraction(manifestPath, scriptPath, workingDir) {
  const commands = [
    { cmd: process.env.PYTHON_BIN || 'python', args: [scriptPath, manifestPath] },
    { cmd: 'py', args: ['-3', scriptPath, manifestPath] }
  ];

  const failures = [];

  for (const candidate of commands) {
    const result = tryRunPython(candidate.cmd, candidate.args, workingDir);
    if (!result.error && result.status === 0) {
      return result.stdout;
    }
    failures.push(result.stderr || result.error?.message || `${candidate.cmd} exited with ${result.status}`);
  }

  throw new Error(`Python extraction failed. ${failures.filter(Boolean).join(' | ')}`);
}

function normalizeWarningArray(warnings) {
  if (!Array.isArray(warnings)) return [];
  return warnings.filter((warning) => typeof warning === 'string' && warning.trim().length > 0);
}

function normalizeExtractedSources(sources) {
  if (!Array.isArray(sources)) return [];

  return sources
    .map((source, index) => ({
      type: source.type === 'pdf' || source.type === 'image' ? source.type : 'unknown',
      name: source.filename || source.name || `source_${index + 1}`,
      rawText: typeof source.extractedText === 'string' ? source.extractedText.trim() : '',
      provenance: {
        kind: source.type === 'image' ? 'image_ocr' : 'pdf_extract',
        index: Number.isInteger(source.index) ? source.index : undefined,
        filename: source.filename || undefined
      },
      confidence: typeof source.confidence === 'number' ? source.confidence : 0,
      warnings: normalizeWarningArray(source.warnings)
    }))
    .filter((source) => source.rawText.length > 0 || source.warnings.length > 0);
}

async function extractSourcesFromFiles(files, requestId, deps = {}) {
  if (!Array.isArray(files) || files.length === 0) {
    return {
      sources: [],
      warnings: [],
      extractionMs: 0
    };
  }

  validateFiles(files);

  const startedAt = Number(process.hrtime.bigint() / BigInt(1e6));
  const fsModule = deps.fsModule || fs;
  const pathModule = deps.pathModule || path;
  const osModule = deps.osModule || os;
  const runPython = deps.runPython || runPythonExtraction;
  const tempDir = fsModule.mkdtempSync(pathModule.join(osModule.tmpdir(), `padhai_${requestId || 'req'}_`));
  const manifestPath = pathModule.join(tempDir, 'manifest.json');
  const scriptPath = pathModule.join(__dirname, 'python', 'extract_sources.py');

  try {
    const manifest = [];
    files.forEach((file, idx) => {
      const safeBaseName = (file.originalname || `upload_${idx + 1}`).replace(/[^\w.-]/g, '_');
      const stagedPath = pathModule.join(tempDir, `${idx + 1}_${safeBaseName}`);
      fsModule.writeFileSync(stagedPath, file.buffer);
      manifest.push({
        filename: file.originalname || safeBaseName,
        mimetype: file.mimetype || '',
        path: stagedPath,
        index: idx
      });
    });

    fsModule.writeFileSync(manifestPath, JSON.stringify({ files: manifest }));
    const stdout = runPython(manifestPath, scriptPath, tempDir);
    const parsed = JSON.parse(stdout || '{}');

    const extractionMs = Number(process.hrtime.bigint() / BigInt(1e6)) - startedAt;

    return {
      sources: normalizeExtractedSources(parsed.sources),
      warnings: normalizeWarningArray(parsed.warnings),
      extractionMs
    };
  } catch (error) {
    const extractionMs = Number(process.hrtime.bigint() / BigInt(1e6)) - startedAt;
    return {
      sources: [],
      warnings: [`File extraction failed: ${error.message}`],
      extractionMs
    };
  } finally {
    try {
      fsModule.rmSync(tempDir, { recursive: true, force: true });
    } catch (cleanupError) {
      // Best-effort cleanup only.
    }
  }
}

module.exports = {
  MAX_TOTAL_UPLOAD_BYTES,
  ALLOWED_MIME_TYPES,
  buildSourceSummary,
  inferInputMode,
  validateFiles,
  extractSourcesFromFiles,
  __private: {
    normalizeExtractedSources,
    normalizeWarningArray,
    runPythonExtraction,
    tryRunPython
  }
};
