const assert = require('node:assert/strict');

const { normalizeGenerateRequest } = require('../services/pipeline/requestNormalizer');
const { validateFiles } = require('../services/pipeline/fileExtractionService');
const { buildLectureContext } = require('../services/pipeline/contextBuilder');
const { assembleGenerationBundle } = require('../services/pipeline/artifactAssembler');
const { createLectureOrchestrator } = require('../services/pipeline/lectureOrchestrator');

async function run() {
  const normalized = await normalizeGenerateRequest({
    body: { prompt: 'Explain inertia' },
    files: []
  });
  assert.equal(normalized.inputMode, 'text_only');
  assert.equal(normalized.normalizedSources.length, 1);
  assert.equal(normalized.normalizedSources[0].type, 'prompt');
  assert.equal(normalized.prompt, 'Explain inertia');
  assert.equal(normalized.generateQuiz, true);
  assert.equal(normalized.generateFlashcards, true);
  assert.ok(typeof normalized.timingsMs.extract_sources === 'number');

  assert.doesNotThrow(() => validateFiles([]));
  assert.throws(
    () => validateFiles([{ mimetype: 'text/plain', size: 100 }]),
    /Unsupported file type/
  );

  const context = buildLectureContext({
    prompt: 'Cell division',
    normalizedSources: [{ type: 'prompt', name: 'prompt', rawText: 'Cell division overview' }],
    sourceSummary: { promptIncluded: true }
  });
  assert.equal(context.topic, 'Cell division');
  assert.equal(context.sourceChunks.length, 1);
  assert.equal(context.sourceChunks[0].sourceType, 'prompt');
  assert.ok(Array.isArray(context.learningObjectives));
  assert.ok(Array.isArray(context.coverageGaps));

  const assembled = assembleGenerationBundle({
    requestId: 'req_1',
    inputMode: 'text_only',
    warnings: [],
    stageTimingsMs: { total: 1000 },
    sourceSummary: { promptIncluded: true },
    lecture: {
      narration: 'Narration',
      manimCode: 'from manim import *',
      title: 'Lecture',
      totalDuration: 90,
      scenes: []
    },
    videoPath: 'C:\\tmp\\lecture.mp4',
    audio: { url: '/audio/lecture.wav' },
    quiz: null,
    flashcards: null
  });
  assert.equal(assembled.success, true);
  assert.equal(assembled.requestId, 'req_1');
  assert.equal(assembled.videoUrl, '/videos/lecture.mp4');
  assert.equal(assembled.narration, 'Narration');
  assert.equal(assembled.manimCode, 'from manim import *');
  assert.ok(Array.isArray(assembled.quiz));
  assert.ok(Array.isArray(assembled.flashcards));
  assert.deepEqual(assembled.sourceSummary, { promptIncluded: true });

  const callOrder = [];
  const orchestrator = createLectureOrchestrator({
    normalizeRequest: async () => {
      callOrder.push('normalize_input');
      return {
        inputMode: 'text_only',
        warnings: [],
        sourceSummary: { promptIncluded: true },
        timingsMs: { extract_sources: 0 },
        generateQuiz: true,
        generateFlashcards: true,
        prompt: 'Inertia',
        normalizedSources: [{ type: 'prompt', name: 'prompt', rawText: 'Inertia' }]
      };
    },
    buildContext: async () => {
      callOrder.push('build_context');
      return { promptText: 'Inertia', topic: 'Inertia', sourceChunks: [] };
    },
    enrichContext: async (context) => {
      callOrder.push('enrich_context');
      return { context, warnings: [] };
    },
    generateLecture: async () => {
      callOrder.push('generate_lecture');
      return { narration: 'N', manimCode: 'M', title: 'T', totalDuration: 90, scenes: [] };
    },
    renderVideo: async () => {
      callOrder.push('render_video');
      return 'C:\\tmp\\lecture.mp4';
    },
    synthesizeAudio: async () => {
      callOrder.push('synthesize_audio');
      return { audioPath: 'C:\\tmp\\lecture.wav', url: '/audio/lecture.wav', warnings: [] };
    },
    muxVideo: async ({ audio }) => {
      callOrder.push('mux_video');
      return { videoPath: 'C:\\tmp\\lecture_narrated.mp4', audio, warnings: [] };
    },
    assembleArtifacts: (payload) => {
      callOrder.push('assemble_response');
      return assembleGenerationBundle(payload);
    },
    generateQuiz: async () => null,
    generateFlashcards: async () => null
  });

  const response = await orchestrator.run({
    req: {},
    requestId: 'req_test'
  });

  assert.deepEqual(callOrder, [
    'normalize_input',
    'build_context',
    'enrich_context',
    'generate_lecture',
    'render_video',
    'synthesize_audio',
    'mux_video',
    'assemble_response'
  ]);
  assert.equal(response.success, true);
  assert.equal(response.requestId, 'req_test');
  assert.ok(response.metadata.stageTimingsMs.total >= 0);
  assert.ok(response.metadata.stageTimingsMs.extract_sources >= 0);
  assert.ok(response.audio?.url?.includes('/audio/'));
  assert.ok(Array.isArray(response.quiz));
  assert.ok(Array.isArray(response.flashcards));

  console.log('All pipeline checks passed.');
}

module.exports = { run };
