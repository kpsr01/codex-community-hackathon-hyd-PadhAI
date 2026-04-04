const { createStructuredResponse } = require('../openai/apiClient');

function contextText(context) {
  const chunks = Array.isArray(context?.sourceChunks) ? context.sourceChunks : [];
  const selected = chunks.slice(0, 10).map((chunk, idx) => {
    return `(${idx + 1}) [${chunk.sourceType}:${chunk.sourceName}] ${chunk.text}`;
  });
  const topic = context?.topic || context?.promptText || 'Uploaded study material';
  return `Topic: ${topic}\nPrompt: ${context?.promptText || '(none)'}\nSource material:\n${selected.join('\n\n')}`;
}

function normalizeQuiz(items) {
  const list = Array.isArray(items) ? items : [];
  const mcq = [];
  const shortAnswer = [];

  list.forEach((item) => {
    if (!item || typeof item !== 'object') return;
    const question = String(item.question || '').trim();
    const answer = String(item.answer || '').trim();
    const explanation = String(item.explanation || '').trim();
    const sourceConcept = String(item.sourceConcept || 'General concept').trim();
    const difficulty = String(item.difficulty || 'medium').trim().toLowerCase();
    const options = Array.isArray(item.options)
      ? item.options.map((option) => String(option).trim()).filter(Boolean).slice(0, 6)
      : [];

    if (!question || !answer || !explanation) return;

    const base = { question, answer, explanation, difficulty, sourceConcept };
    if (options.length >= 3) {
      mcq.push({ ...base, options });
    } else {
      shortAnswer.push(base);
    }
  });

  return [...mcq.slice(0, 4), ...shortAnswer.slice(0, 2)];
}

function normalizeFlashcards(items) {
  const list = Array.isArray(items) ? items : [];
  const cards = [];

  list.forEach((item) => {
    if (!item || typeof item !== 'object') return;
    const front = String(item.front || '').trim();
    const back = String(item.back || '').trim();
    if (!front || !back) return;

    cards.push({
      front,
      back,
      tag: String(item.tag || 'concept').trim(),
      sourceConcept: String(item.sourceConcept || 'General concept').trim()
    });
  });

  return cards.slice(0, 10);
}

function buildQuizSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      quiz: {
        type: 'array',
        minItems: 6,
        maxItems: 6,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            question: { type: 'string', minLength: 1 },
            options: {
              type: 'array',
              maxItems: 6,
              items: { type: 'string', minLength: 1 }
            },
            answer: { type: 'string', minLength: 1 },
            explanation: { type: 'string', minLength: 1 },
            difficulty: { type: 'string', enum: ['easy', 'medium', 'hard'] },
            sourceConcept: { type: 'string', minLength: 1 }
          },
          required: ['question', 'options', 'answer', 'explanation', 'difficulty', 'sourceConcept']
        }
      }
    },
    required: ['quiz']
  };
}

function buildFlashcardSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      flashcards: {
        type: 'array',
        minItems: 10,
        maxItems: 10,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            front: { type: 'string', minLength: 1 },
            back: { type: 'string', minLength: 1 },
            tag: { type: 'string', minLength: 1 },
            sourceConcept: { type: 'string', minLength: 1 }
          },
          required: ['front', 'back', 'tag', 'sourceConcept']
        }
      }
    },
    required: ['flashcards']
  };
}

async function generateQuizFromContext(context, deps = {}) {
  const prompt = contextText(context);
  const { parsed } = await createStructuredResponse({
    name: 'lecture_quiz',
    reasoningEffort: 'low',
    instructions: [
      'Generate exactly 6 quiz questions grounded only in the provided material.',
      'Return 4 multiple-choice questions and 2 short-answer questions.',
      'For short-answer questions, use an empty options array.',
      'Keep explanations concise and educational.'
    ].join(' '),
    input: prompt,
    schema: buildQuizSchema()
  }, deps);

  const quiz = normalizeQuiz(parsed?.quiz || []);
  if (quiz.length < 6) {
    throw new Error('Quiz output was incomplete.');
  }
  return quiz.slice(0, 6);
}

async function generateFlashcardsFromContext(context, deps = {}) {
  const prompt = contextText(context);
  const { parsed } = await createStructuredResponse({
    name: 'lecture_flashcards',
    reasoningEffort: 'low',
    instructions: [
      'Generate exactly 10 flashcards grounded only in the provided material.',
      'Cover definitions, formulas, examples, and common confusions where possible.',
      'Keep fronts short and backs specific.'
    ].join(' '),
    input: prompt,
    schema: buildFlashcardSchema()
  }, deps);

  const flashcards = normalizeFlashcards(parsed?.flashcards || []);
  if (flashcards.length < 10) {
    throw new Error('Flashcard output was incomplete.');
  }
  return flashcards.slice(0, 10);
}

module.exports = {
  generateQuizFromContext,
  generateFlashcardsFromContext,
  __private: {
    contextText,
    normalizeQuiz,
    normalizeFlashcards,
    buildQuizSchema,
    buildFlashcardSchema
  }
};
