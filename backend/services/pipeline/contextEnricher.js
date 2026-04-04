const { createStructuredResponse } = require('../openai/apiClient');

function buildEnrichmentInput(context) {
  const sourceChunks = Array.isArray(context?.sourceChunks) ? context.sourceChunks : [];
  const compact = {
    topic: context?.topic || '',
    promptText: context?.promptText || '',
    learningObjectives: Array.isArray(context?.learningObjectives) ? context.learningObjectives : [],
    keyConcepts: Array.isArray(context?.keyConcepts) ? context.keyConcepts : [],
    definitions: Array.isArray(context?.definitions) ? context.definitions : [],
    formulas: Array.isArray(context?.formulas) ? context.formulas : [],
    examples: Array.isArray(context?.examples) ? context.examples : [],
    coverageGaps: Array.isArray(context?.coverageGaps) ? context.coverageGaps : [],
    sourceChunks: sourceChunks.slice(0, 12).map((chunk) => ({
      id: chunk.id,
      sourceType: chunk.sourceType,
      sourceName: chunk.sourceName,
      text: chunk.text
    }))
  };

  return JSON.stringify(compact, null, 2);
}

function buildContextEnrichmentSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      topic: { type: 'string', minLength: 1 },
      learningObjectives: {
        type: 'array',
        minItems: 1,
        maxItems: 6,
        items: { type: 'string', minLength: 1 }
      },
      keyConcepts: {
        type: 'array',
        maxItems: 16,
        items: { type: 'string', minLength: 1 }
      },
      definitions: {
        type: 'array',
        maxItems: 12,
        items: { type: 'string', minLength: 1 }
      },
      formulas: {
        type: 'array',
        maxItems: 12,
        items: { type: 'string', minLength: 1 }
      },
      examples: {
        type: 'array',
        maxItems: 12,
        items: { type: 'string', minLength: 1 }
      },
      coverageGaps: {
        type: 'array',
        maxItems: 12,
        items: { type: 'string', minLength: 1 }
      }
    },
    required: [
      'topic',
      'learningObjectives',
      'keyConcepts',
      'definitions',
      'formulas',
      'examples',
      'coverageGaps'
    ]
  };
}

function sanitizeStringArray(items, fallback = []) {
  const values = Array.isArray(items) ? items : fallback;
  return values
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}

async function enrichLectureContext(context, deps = {}) {
  try {
    const { parsed } = await createStructuredResponse({
      name: 'lecture_context',
      reasoningEffort: 'low',
      instructions: [
        'You enrich lecture context for an educational video pipeline.',
        'Return structured JSON only.',
        'Ground every field in the provided sourceChunks.',
        'Do not invent facts outside the provided material.',
        'Keep learning objectives concise and implementation-ready.'
      ].join(' '),
      input: buildEnrichmentInput(context),
      schema: buildContextEnrichmentSchema()
    }, deps);

    const enriched = parsed && typeof parsed === 'object' ? parsed : {};

    return {
      context: {
        ...context,
        topic: String(enriched.topic || context.topic || '').trim() || context.topic,
        learningObjectives: sanitizeStringArray(enriched.learningObjectives, context.learningObjectives),
        keyConcepts: sanitizeStringArray(enriched.keyConcepts, context.keyConcepts),
        definitions: sanitizeStringArray(enriched.definitions, context.definitions),
        formulas: sanitizeStringArray(enriched.formulas, context.formulas),
        examples: sanitizeStringArray(enriched.examples, context.examples),
        coverageGaps: sanitizeStringArray(
          [...sanitizeStringArray(context.coverageGaps), ...sanitizeStringArray(enriched.coverageGaps)]
        ),
        sourceChunks: Array.isArray(context.sourceChunks) ? context.sourceChunks : [],
        sourceSummary: context.sourceSummary || {}
      },
      warnings: []
    };
  } catch (error) {
    return {
      context,
      warnings: [`Context enrichment fell back to heuristics: ${error.message}`]
    };
  }
}

module.exports = {
  enrichLectureContext,
  __private: {
    buildEnrichmentInput,
    buildContextEnrichmentSchema,
    sanitizeStringArray
  }
};
