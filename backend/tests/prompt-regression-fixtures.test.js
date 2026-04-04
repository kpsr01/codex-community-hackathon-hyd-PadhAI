const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { normalizeGenerateRequest } = require('../services/pipeline/requestNormalizer');
const { buildLectureContext } = require('../services/pipeline/contextBuilder');
const { __private: studyPrivate } = require('../services/pipeline/studyArtifactStubs');

async function run() {
  const fixturesPath = path.join(__dirname, 'fixtures', 'prompt-regression.json');
  const fixtures = JSON.parse(fs.readFileSync(fixturesPath, 'utf8'));

  for (const fixture of fixtures) {
    const files = (fixture.req.files || []).map((file) => ({ ...file, buffer: Buffer.from('x') }));

    const normalized = await normalizeGenerateRequest({
      body: fixture.req.body || {},
      files,
      requestId: `req_${fixture.name}`
    }, {
      validateFiles: () => {},
      extractSourcesFromFiles: async () => ({
        sources: fixture.extractionSources || [],
        warnings: fixture.extractionWarnings || [],
        extractionMs: 1
      })
    });

    assert.equal(normalized.inputMode, fixture.expectedInputMode, fixture.name);

    const context = buildLectureContext(normalized);
    if (normalized.prompt) {
      assert.equal(context.promptText, normalized.prompt, fixture.name);
    }

    const contextDump = studyPrivate.contextText(context);
    const chunkTexts = context.sourceChunks.map((chunk) => chunk.text);
    for (const text of chunkTexts.slice(0, 3)) {
      assert.ok(contextDump.includes(text.slice(0, Math.min(12, text.length))), `${fixture.name} should remain grounded`);
    }

    if (fixture.name === 'low-confidence-ocr') {
      assert.ok(normalized.warnings.some((item) => item.includes('Low OCR confidence')));
    }
  }

  const quizNormalized = studyPrivate.normalizeQuiz([
    { question: 'Q1', options: ['A', 'B', 'C'], answer: 'A', explanation: 'E', difficulty: 'easy', sourceConcept: 'C1' },
    { question: 'Q2', options: ['A', 'B', 'C'], answer: 'A', explanation: 'E', difficulty: 'easy', sourceConcept: 'C2' },
    { question: 'Q3', options: ['A', 'B', 'C'], answer: 'A', explanation: 'E', difficulty: 'easy', sourceConcept: 'C3' },
    { question: 'Q4', options: ['A', 'B', 'C'], answer: 'A', explanation: 'E', difficulty: 'easy', sourceConcept: 'C4' },
    { question: 'Q5', answer: 'A', explanation: 'E', difficulty: 'medium', sourceConcept: 'C5' },
    { question: 'Q6', answer: 'A', explanation: 'E', difficulty: 'hard', sourceConcept: 'C6' }
  ]);
  assert.equal(quizNormalized.length, 6);

  const flashcardsNormalized = studyPrivate.normalizeFlashcards(Array.from({ length: 12 }, (_, i) => ({
    front: `Front ${i}`,
    back: `Back ${i}`,
    tag: i % 2 ? 'definition' : 'example',
    sourceConcept: `Concept ${i}`
  })));
  assert.equal(flashcardsNormalized.length, 10);
}

module.exports = { run };
