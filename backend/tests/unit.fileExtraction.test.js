const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  validateFiles,
  inferInputMode,
  buildSourceSummary,
  extractSourcesFromFiles,
  __private
} = require('../services/pipeline/fileExtractionService');

async function run() {
  assert.doesNotThrow(() => validateFiles([{ mimetype: 'application/pdf', size: 1024 }]));
  assert.doesNotThrow(() => validateFiles(Array.from({ length: 5 }, () => ({ mimetype: 'image/png', size: 1000 }))));

  assert.throws(() => validateFiles([{ mimetype: 'application/pdf', size: 10 }, { mimetype: 'image/png', size: 10 }]), /either 1 PDF or up to 5 images/);
  assert.throws(() => validateFiles([{ mimetype: 'application/pdf', size: 10 }, { mimetype: 'application/pdf', size: 10 }]), /Only 1 PDF/);
  assert.throws(() => validateFiles(Array.from({ length: 6 }, () => ({ mimetype: 'image/jpeg', size: 10 }))), /maximum of 5 images/);
  assert.throws(() => validateFiles([{ mimetype: 'application/zip', size: 10 }]), /Unsupported file type/);
  assert.throws(() => validateFiles([{ mimetype: 'image/jpeg', size: 25 * 1024 * 1024 }]), /exceeds 20 MB/);

  assert.equal(inferInputMode('topic', [{ type: 'pdf' }]), 'mixed');
  assert.equal(inferInputMode('', [{ type: 'pdf' }]), 'pdf_only');
  assert.equal(inferInputMode('', [{ type: 'image' }]), 'image_only');
  assert.equal(inferInputMode('', [{ type: 'pdf' }, { type: 'image' }]), 'file_only_mixed');
  assert.equal(inferInputMode('topic', []), 'text_only');

  const summary = buildSourceSummary([
    { type: 'prompt', rawText: 'x' },
    { type: 'pdf', rawText: 'hello' },
    { type: 'image', rawText: 'world' }
  ], 'prompt');
  assert.equal(summary.promptIncluded, true);
  assert.equal(summary.fileSourceCount, 2);
  assert.equal(summary.extractedChars, 10);

  const normalized = __private.normalizeExtractedSources([
    { type: 'pdf', filename: 'a.pdf', index: 0, extractedText: '  text  ', confidence: 0.8, warnings: ['x'] },
    { type: 'image', filename: 'b.png', index: 1, extractedText: '', confidence: 0.2, warnings: ['no text'] }
  ]);
  assert.equal(normalized.length, 2);
  assert.equal(normalized[0].rawText, 'text');
  assert.equal(normalized[1].provenance.kind, 'image_ocr');

  let manifestPathSeen = '';
  const result = await extractSourcesFromFiles([
    {
      originalname: 'notes.pdf',
      mimetype: 'application/pdf',
      size: 16,
      buffer: Buffer.from('dummy')
    }
  ], 'cleanup', {
    runPython: (manifestPath) => {
      manifestPathSeen = manifestPath;
      return JSON.stringify({
        sources: [{ type: 'pdf', filename: 'notes.pdf', index: 0, extractedText: 'content', confidence: 0.9, warnings: [] }],
        warnings: []
      });
    }
  });

  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].name, 'notes.pdf');
  assert.ok(manifestPathSeen.length > 0);
  assert.equal(fs.existsSync(path.dirname(manifestPathSeen)), false);

  const failed = await extractSourcesFromFiles([
    {
      originalname: 'scan.jpg',
      mimetype: 'image/jpeg',
      size: 8,
      buffer: Buffer.from('dummy')
    }
  ], 'failure', {
    runPython: () => { throw new Error('boom'); }
  });

  assert.equal(failed.sources.length, 0);
  assert.match(failed.warnings[0], /File extraction failed/);
}

module.exports = { run };
