require('./contracts');
const {
  extractSourcesFromFiles,
  buildSourceSummary,
  inferInputMode,
  validateFiles
} = require('./fileExtractionService');

function parseBooleanFlag(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'on', 'enabled'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off', 'disabled'].includes(normalized)) return false;
  return fallback;
}

/**
 * Normalize request shape across JSON and multipart forms.
 * @param {import('express').Request} req
 */
async function normalizeGenerateRequest(req, deps = {}) {
  const body = req.body || {};
  const files = Array.isArray(req.files) ? req.files : [];
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  const warnings = [];
  const timingsMs = {};

  const promptSource = prompt ? [{
    type: 'prompt',
    name: 'prompt',
    rawText: prompt,
    provenance: { kind: 'user_prompt' },
    confidence: 1,
    warnings: []
  }] : [];

  const validate = deps.validateFiles || validateFiles;
  const extract = deps.extractSourcesFromFiles || extractSourcesFromFiles;
  validate(files);

  const extraction = await extract(files, req.requestId || 'req');
  const fileSources = extraction.sources;
  const extractedTextSources = fileSources.filter((source) => typeof source.rawText === 'string' && source.rawText.trim().length > 0);
  warnings.push(...(extraction.warnings || []));
  timingsMs.extract_sources = extraction.extractionMs || 0;

  if (files.length > 0 && extractedTextSources.length === 0) {
    const err = new Error(
      'Could not extract usable text from uploaded files. Install PyMuPDF + pytesseract (and Tesseract OCR) or upload text-based PDFs/images with readable text.'
    );
    err.status = 422;
    err.details = warnings;
    throw err;
  }

  const normalizedSources = [...promptSource, ...fileSources];
  const sourceSummary = buildSourceSummary(normalizedSources, prompt);

  return {
    prompt,
    files,
    generateQuiz: parseBooleanFlag(body.generateQuiz, true),
    generateFlashcards: parseBooleanFlag(body.generateFlashcards, true),
    inputMode: inferInputMode(prompt, fileSources.length > 0 ? fileSources : files),
    normalizedSources,
    sourceSummary,
    warnings,
    timingsMs
  };
}

module.exports = {
  normalizeGenerateRequest,
  extractSourcesFromFiles
};
