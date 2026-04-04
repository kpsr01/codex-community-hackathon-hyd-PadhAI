const assert = require('node:assert/strict');

const { __private: openaiPrivate } = require('../services/openai/apiClient');

async function run() {
  assert.equal(openaiPrivate.parseBooleanEnv('true'), true);
  assert.equal(openaiPrivate.parseBooleanEnv('false'), false);

  const structuredPayload = openaiPrivate.buildStructuredResponsePayload({
    instructions: 'Talk like a teacher.',
    input: 'Explain inertia.',
    schema: { type: 'object', properties: {}, additionalProperties: false },
    name: 'lecture',
    model: 'gpt-5.4',
    store: false,
    reasoningEffort: 'medium',
    verbosity: 'medium'
  });

  assert.equal(structuredPayload.model, 'gpt-5.4');
  assert.equal(structuredPayload.store, false);
  assert.deepEqual(structuredPayload.reasoning, { effort: 'medium' });
  assert.equal(structuredPayload.text.format.type, 'json_schema');
  assert.equal(structuredPayload.text.format.name, 'lecture');
  assert.equal(structuredPayload.text.verbosity, 'medium');
  assert.equal(structuredPayload.input[0].role, 'developer');
  assert.equal(structuredPayload.input[1].role, 'user');

  const speechPayload = openaiPrivate.buildSpeechPayload({
    model: 'gpt-4o-mini-tts-2025-12-15',
    voice: 'marin',
    input: 'Hello world',
    instructions: 'Warm and clear',
    responseFormat: 'wav'
  });

  assert.equal(speechPayload.model, 'gpt-4o-mini-tts-2025-12-15');
  assert.equal(speechPayload.voice, 'marin');
  assert.equal(speechPayload.response_format, 'wav');
  assert.equal(speechPayload.instructions, 'Warm and clear');

  const responseText = openaiPrivate.extractResponseText({
    output: [
      {
        content: [
          { text: '{"ok":true}' }
        ]
      }
    ]
  });
  assert.equal(responseText, '{"ok":true}');

  const parsed = openaiPrivate.extractParsedOutput({
    output_text: '{"quiz":[]}'
  });
  assert.deepEqual(parsed, { quiz: [] });
}

module.exports = { run };
