const assert = require('node:assert/strict');

const { buildLectureContext, __private } = require('../services/pipeline/contextBuilder');

async function run() {
  const longText = Array.from({ length: 80 }, (_, i) => `Section ${i + 1}: ${'abc '.repeat(120)}`).join('\n\n');

  const context = buildLectureContext({
    prompt: '',
    normalizedSources: [
      { type: 'pdf', name: 'notes.pdf', rawText: longText, provenance: { index: 0 } }
    ],
    sourceSummary: { fileSourceCount: 1 }
  });

  assert.ok(context.sourceChunks.length > 1);
  context.sourceChunks.forEach((chunk) => {
    assert.ok(chunk.text.length <= __private.MAX_CHUNK_CHARS);
  });

  const totalChars = context.sourceChunks.reduce((acc, chunk) => acc + chunk.text.length, 0);
  assert.ok(totalChars <= (__private.MAX_CONTEXT_CHARS + __private.MAX_CHUNK_CHARS));
  assert.ok(context.coverageGaps.some((item) => item.includes('No explicit prompt')));

  const chunks = __private.splitIntoChunks('A\n\nB\n\nC', 3);
  assert.deepEqual(chunks, ['A', 'B', 'C']);

  const heuristics = __private.extractHeuristics([
    { text: 'Newton Law is defined as force relation. F = m*a. For instance, falling objects.' }
  ]);
  assert.ok(Array.isArray(heuristics.keyConcepts));
  assert.ok(Array.isArray(heuristics.definitions));
  assert.ok(Array.isArray(heuristics.formulas));
  assert.ok(Array.isArray(heuristics.examples));

  assert.equal(__private.isLowSignalPrompt('explain these concepts'), true);
  assert.equal(__private.isLowSignalPrompt('Explain this topic'), true);
  assert.equal(__private.isLowSignalPrompt('Explain photosynthesis step-by-step with emphasis on light-dependent reactions'), false);

  const mixedContext = buildLectureContext({
    prompt: 'explain these concepts',
    normalizedSources: [
      { type: 'prompt', name: 'prompt', rawText: 'explain these concepts' },
      { type: 'pdf', name: 'notes.pdf', rawText: 'Photosynthesis has light reactions and Calvin cycle.' }
    ],
    sourceSummary: { fileSourceCount: 1 }
  });

  assert.equal(mixedContext.sourceChunks[0].sourceType, 'pdf');
  assert.ok(mixedContext.topic.toLowerCase().includes('photosynthesis'));
  assert.ok(mixedContext.coverageGaps.some((item) => item.includes('low-signal')));
}

module.exports = { run };
