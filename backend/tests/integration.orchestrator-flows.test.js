const assert = require('node:assert/strict');

const { createLectureOrchestrator } = require('../services/pipeline/lectureOrchestrator');
const { assembleGenerationBundle } = require('../services/pipeline/artifactAssembler');

function makeOrchestrator(normalized) {
  return createLectureOrchestrator({
    normalizeRequest: async () => normalized,
    buildContext: async (n) => ({
      topic: n.prompt || 'topic',
      promptText: n.prompt || '',
      sourceChunks: n.normalizedSources || []
    }),
    enrichContext: async (context) => ({ context, warnings: [] }),
    generateLecture: async () => ({ narration: 'N', manimCode: 'M', title: 'T', totalDuration: 90, scenes: [] }),
    renderVideo: async () => 'C:\\tmp\\lecture.mp4',
    synthesizeAudio: async () => ({ audioPath: 'C:\\tmp\\lecture.wav', url: '/audio/lecture.wav', warnings: [] }),
    muxVideo: async ({ audio }) => ({
      videoPath: 'C:\\tmp\\lecture_narrated.mp4',
      audio: { ...audio, muxedVideoUrl: '/videos/lecture_narrated.mp4' },
      warnings: []
    }),
    assembleArtifacts: (payload) => assembleGenerationBundle(payload),
    generateQuiz: async () => [{ question: 'Q1', answer: 'A1', explanation: 'E1', difficulty: 'easy', sourceConcept: 'C1', options: ['A1', 'B1', 'C1'] }],
    generateFlashcards: async () => [{ front: 'F1', back: 'B1', tag: 'definition', sourceConcept: 'C1' }]
  });
}

async function run() {
  const flowCases = [
    { name: 'prompt-only', normalized: { inputMode: 'text_only', warnings: [], sourceSummary: {}, timingsMs: { extract_sources: 1 }, generateQuiz: true, generateFlashcards: true, prompt: 'topic', normalizedSources: [{ text: 'topic' }] } },
    { name: 'pdf-only', normalized: { inputMode: 'pdf_only', warnings: [], sourceSummary: {}, timingsMs: { extract_sources: 1 }, generateQuiz: true, generateFlashcards: true, prompt: '', normalizedSources: [{ text: 'pdf' }] } },
    { name: 'image-only', normalized: { inputMode: 'image_only', warnings: [], sourceSummary: {}, timingsMs: { extract_sources: 1 }, generateQuiz: true, generateFlashcards: true, prompt: '', normalizedSources: [{ text: 'image' }] } },
    { name: 'prompt+file', normalized: { inputMode: 'mixed', warnings: [], sourceSummary: {}, timingsMs: { extract_sources: 1 }, generateQuiz: true, generateFlashcards: true, prompt: 'prompt', normalizedSources: [{ text: 'pdf chunk' }] } }
  ];

  for (const flow of flowCases) {
    const orchestrator = makeOrchestrator(flow.normalized);
    const response = await orchestrator.run({ req: {}, requestId: `req_${flow.name}` });
    assert.equal(response.success, true, flow.name);
    assert.ok(response.videoUrl.includes('/videos/'));
    assert.ok(response.audio?.url?.includes('/audio/'));
  }

  const partialOrchestrator = createLectureOrchestrator({
    normalizeRequest: async () => ({
      inputMode: 'mixed',
      warnings: ['Low-confidence OCR on page 3'],
      sourceSummary: {},
      timingsMs: { extract_sources: 4 },
      generateQuiz: true,
      generateFlashcards: true,
      prompt: 'topic',
      normalizedSources: [{ text: 'chunk' }]
    }),
    buildContext: async () => ({ topic: 'topic', promptText: 'topic', sourceChunks: [{ text: 'chunk' }] }),
    generateLecture: async () => ({ narration: 'N', manimCode: 'M', title: 'T', totalDuration: 90, scenes: [] }),
    renderVideo: async () => 'C:\\tmp\\lecture.mp4',
    assembleArtifacts: (payload) => assembleGenerationBundle(payload),
    generateQuiz: async () => { throw new Error('Quiz service down'); },
    generateFlashcards: async () => { throw new Error('Flashcard service down'); }
  });

  const partial = await partialOrchestrator.run({ req: {}, requestId: 'req_partial' });
  assert.equal(partial.success, true);
  assert.equal(partial.quiz.length, 0);
  assert.equal(partial.flashcards.length, 0);
  assert.ok(partial.warnings.some((item) => item.includes('Low-confidence OCR')));
  assert.ok(partial.warnings.some((item) => item.includes('Quiz generation failed')));
  assert.ok(partial.warnings.some((item) => item.includes('Flashcard generation failed')));

  const lectureWarningOrchestrator = createLectureOrchestrator({
    normalizeRequest: async () => ({
      inputMode: 'pdf_only',
      warnings: [],
      sourceSummary: {},
      timingsMs: { extract_sources: 2 },
      generateQuiz: false,
      generateFlashcards: false,
      prompt: '',
      normalizedSources: [{ text: 'chunk' }]
    }),
    buildContext: async () => ({ topic: 'topic', promptText: '', sourceChunks: [{ text: 'chunk' }] }),
    enrichContext: async (context) => ({ context, warnings: ['Context enrichment fell back to heuristics: timeout'] }),
    generateLecture: async () => ({
      narration: 'N',
      manimCode: 'M',
      title: 'T',
      totalDuration: 90,
      scenes: [],
      warnings: ['Lecture generation used a grounded fallback: malformed model response.']
    }),
    renderVideo: async () => 'C:\\tmp\\lecture.mp4',
    synthesizeAudio: async () => ({ audioPath: 'C:\\tmp\\lecture.wav', url: '/audio/lecture.wav', warnings: [] }),
    muxVideo: async ({ audio }) => ({ videoPath: 'C:\\tmp\\lecture_narrated.mp4', audio, warnings: [] }),
    assembleArtifacts: (payload) => assembleGenerationBundle(payload),
    generateQuiz: async () => [],
    generateFlashcards: async () => []
  });

  const lectureWarning = await lectureWarningOrchestrator.run({ req: {}, requestId: 'req_lecture_warning' });
  assert.ok(lectureWarning.warnings.some((item) => item.includes('grounded fallback')));
  assert.ok(lectureWarning.warnings.some((item) => item.includes('Context enrichment')));

  const fatalOrchestrator = createLectureOrchestrator({
    normalizeRequest: async () => ({
      inputMode: 'text_only',
      warnings: [],
      sourceSummary: {},
    timingsMs: { extract_sources: 0 },
    generateQuiz: false,
    generateFlashcards: false,
    prompt: 'topic',
    normalizedSources: []
    }),
    buildContext: async () => ({ topic: 'topic', promptText: 'topic', sourceChunks: [] }),
    generateLecture: async () => ({ narration: 'N', manimCode: 'M', title: 'T', totalDuration: 90, scenes: [] }),
    renderVideo: async () => { throw new Error('Render failed'); },
    synthesizeAudio: async () => ({ audioPath: 'C:\\tmp\\lecture.wav', url: '/audio/lecture.wav', warnings: [] }),
    muxVideo: async ({ audio }) => ({ videoPath: 'C:\\tmp\\lecture_narrated.mp4', audio, warnings: [] }),
    assembleArtifacts: (payload) => assembleGenerationBundle(payload),
    generateQuiz: async () => [],
    generateFlashcards: async () => []
  });

  await assert.rejects(() => fatalOrchestrator.run({ req: {}, requestId: 'req_fatal' }), /Render failed/);

  const audioFatalOrchestrator = createLectureOrchestrator({
    normalizeRequest: async () => ({
      inputMode: 'text_only',
      warnings: [],
      sourceSummary: {},
      timingsMs: { extract_sources: 0 },
      generateQuiz: false,
      generateFlashcards: false,
      prompt: 'topic',
      normalizedSources: []
    }),
    buildContext: async () => ({ topic: 'topic', promptText: 'topic', sourceChunks: [] }),
    enrichContext: async (context) => ({ context, warnings: [] }),
    generateLecture: async () => ({ narration: 'N', manimCode: 'M', title: 'T', totalDuration: 90, scenes: [] }),
    renderVideo: async () => 'C:\\tmp\\lecture.mp4',
    synthesizeAudio: async () => { throw new Error('Audio failed'); },
    muxVideo: async ({ audio }) => ({ videoPath: 'C:\\tmp\\lecture_narrated.mp4', audio, warnings: [] }),
    assembleArtifacts: (payload) => assembleGenerationBundle(payload),
    generateQuiz: async () => [],
    generateFlashcards: async () => []
  });

  await assert.rejects(() => audioFatalOrchestrator.run({ req: {}, requestId: 'req_audio_fatal' }), /Audio failed/);
}

module.exports = { run };
