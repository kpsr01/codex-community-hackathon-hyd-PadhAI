const assert = require('node:assert/strict');

const { normalizeGenerateRequest } = require('../services/pipeline/requestNormalizer');
const { buildLectureContext } = require('../services/pipeline/contextBuilder');
const { assembleGenerationBundle } = require('../services/pipeline/artifactAssembler');

function assertLegacyFields(payload) {
  ['videoUrl', 'narration', 'manimCode', 'title', 'totalDuration', 'scenes'].forEach((key) => {
    assert.ok(Object.prototype.hasOwnProperty.call(payload, key), `Missing legacy field ${key}`);
  });
}

function assertNewFields(payload) {
  ['requestId', 'inputMode', 'sourceSummary', 'quiz', 'flashcards', 'warnings', 'audio'].forEach((key) => {
    assert.ok(Object.prototype.hasOwnProperty.call(payload, key), `Missing new field ${key}`);
  });
}

async function buildContractPayload(req, extractionSources) {
  const normalized = await normalizeGenerateRequest(req, {
    validateFiles: () => {},
    extractSourcesFromFiles: async () => ({ sources: extractionSources, warnings: [], extractionMs: 3 })
  });
  const context = buildLectureContext(normalized);

  return assembleGenerationBundle({
    requestId: 'req_contract',
    inputMode: normalized.inputMode,
    warnings: normalized.warnings,
    stageTimingsMs: { total: 50 },
    sourceSummary: normalized.sourceSummary,
    lecture: {
      narration: `Narration for ${context.topic}`,
      manimCode: 'from manim import *',
      title: 'Contract Lecture',
      totalDuration: 90,
      scenes: []
    },
    videoPath: 'C:\\tmp\\lecture.mp4',
    audio: null,
    quiz: [],
    flashcards: []
  });
}

async function run() {
  const jsonPayload = await buildContractPayload({ body: { prompt: 'Explain photosynthesis' }, files: [] }, []);
  assert.equal(jsonPayload.inputMode, 'text_only');
  assertLegacyFields(jsonPayload);
  assertNewFields(jsonPayload);

  const multipartPayload = await buildContractPayload({
    body: { prompt: '', generateQuiz: 'true', generateFlashcards: 'true' },
    files: [{ mimetype: 'image/png', size: 100, originalname: 'page1.png', buffer: Buffer.from('x') }]
  }, [
    {
      type: 'image',
      name: 'page1.png',
      rawText: 'chlorophyll absorbs light',
      confidence: 0.7,
      provenance: { kind: 'image_ocr', index: 0, filename: 'page1.png' },
      warnings: []
    }
  ]);

  assert.equal(multipartPayload.inputMode, 'image_only');
  assert.equal(Array.isArray(multipartPayload.scenes), true);
  assert.equal(Array.isArray(multipartPayload.quiz), true);
  assert.equal(Array.isArray(multipartPayload.flashcards), true);
  assertLegacyFields(multipartPayload);
  assertNewFields(multipartPayload);
}

module.exports = { run };
