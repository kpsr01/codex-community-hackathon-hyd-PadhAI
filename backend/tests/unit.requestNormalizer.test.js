const assert = require('node:assert/strict');

const { normalizeGenerateRequest } = require('../services/pipeline/requestNormalizer');

async function run() {
  const reqA = {
    body: {
      prompt: '  Explain entropy  ',
      generateQuiz: 'true',
      generateFlashcards: '1'
    },
    files: [],
    requestId: 'a'
  };

  const outA = await normalizeGenerateRequest(reqA, {
    validateFiles: () => {},
    extractSourcesFromFiles: async () => ({ sources: [], warnings: [], extractionMs: 5 })
  });

  assert.equal(outA.prompt, 'Explain entropy');
  assert.equal(outA.inputMode, 'text_only');
  assert.equal(outA.generateQuiz, true);
  assert.equal(outA.generateFlashcards, true);
  assert.equal(outA.normalizedSources[0].type, 'prompt');
  assert.equal(outA.timingsMs.extract_sources, 5);

  const outDefaultFlags = await normalizeGenerateRequest({
    body: { prompt: 'Kinematics' },
    files: [],
    requestId: 'defaults'
  }, {
    validateFiles: () => {},
    extractSourcesFromFiles: async () => ({ sources: [], warnings: [], extractionMs: 3 })
  });
  assert.equal(outDefaultFlags.generateQuiz, true);
  assert.equal(outDefaultFlags.generateFlashcards, true);

  const reqB = {
    body: { prompt: '', generateQuiz: 'off', generateFlashcards: 'false' },
    files: [{ mimetype: 'application/pdf', size: 10, originalname: 'x.pdf', buffer: Buffer.from('x') }],
    requestId: 'b'
  };

  const outB = await normalizeGenerateRequest(reqB, {
    validateFiles: () => {},
    extractSourcesFromFiles: async () => ({
      sources: [{
        type: 'pdf',
        name: 'x.pdf',
        rawText: 'extracted text',
        confidence: 0.9,
        provenance: { kind: 'pdf_extract', index: 0, filename: 'x.pdf' },
        warnings: []
      }],
      warnings: ['warn'],
      extractionMs: 7
    })
  });

  assert.equal(outB.inputMode, 'pdf_only');
  assert.equal(outB.generateQuiz, false);
  assert.equal(outB.generateFlashcards, false);
  assert.equal(outB.warnings[0], 'warn');
  assert.equal(outB.sourceSummary.promptIncluded, false);

  await assert.rejects(
    () => normalizeGenerateRequest(reqB, {
      validateFiles: () => {},
      extractSourcesFromFiles: async () => ({ sources: [], warnings: ['PyMuPDF unavailable'], extractionMs: 2 })
    }),
    /Could not extract usable text from uploaded files/
  );
}

module.exports = { run };
