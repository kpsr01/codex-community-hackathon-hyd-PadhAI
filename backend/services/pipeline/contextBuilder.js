require('./contracts');

const MAX_CHUNK_CHARS = 1200;
const MAX_CONTEXT_CHARS = 24000;

function isLowSignalPrompt(prompt) {
  const value = (prompt || '').trim().toLowerCase();
  if (!value) return true;
  if (value.length <= 12) return true;
  if (/^explain\s+(this|these|the)\s+(concept|concepts|topic|topics)\b/.test(value)) return true;
  if (/^(explain|teach|describe|summarize)\b.{0,20}\b(concept|concepts|topic|topics)\b/.test(value)) return true;
  return false;
}

function splitIntoChunks(text, chunkSize) {
  if (!text) return [];
  const paragraphs = text.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  if (paragraphs.length === 0) return [];

  const chunks = [];
  let current = '';

  for (const paragraph of paragraphs) {
    if ((current + '\n\n' + paragraph).trim().length <= chunkSize) {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
    } else {
      if (current) chunks.push(current);
      if (paragraph.length <= chunkSize) {
        current = paragraph;
      } else {
        for (let index = 0; index < paragraph.length; index += chunkSize) {
          chunks.push(paragraph.slice(index, index + chunkSize).trim());
        }
        current = '';
      }
    }
  }

  if (current) chunks.push(current);
  return chunks.filter(Boolean);
}

function extractHeuristics(sourceChunks) {
  const conceptSet = new Set();
  const definitionSet = new Set();
  const formulaSet = new Set();
  const exampleSet = new Set();

  const keywordPattern = /\b([A-Z][a-z]+(?:\s+[A-Z]?[a-z]+){0,3})\b/g;
  const definitionPattern = /\b(.{0,60}\b(?:is|are|means|defined as)\b.{0,80})/gi;
  const formulaPattern = /([A-Za-z]\s*=\s*[^.,;\n]{1,40})/g;
  const examplePattern = /\b(example|for instance|consider)\b.{0,120}/gi;

  sourceChunks.forEach((chunk) => {
    const text = chunk.text || '';

    const keywordMatches = text.match(keywordPattern) || [];
    keywordMatches.forEach((match) => {
      const cleaned = match.trim();
      if (cleaned.length >= 4 && cleaned.length <= 40) {
        conceptSet.add(cleaned);
      }
    });

    const definitionMatches = text.match(definitionPattern) || [];
    definitionMatches.slice(0, 2).forEach((match) => definitionSet.add(match.trim()));

    const formulaMatches = text.match(formulaPattern) || [];
    formulaMatches.slice(0, 2).forEach((match) => formulaSet.add(match.trim()));

    const exampleMatches = text.match(examplePattern) || [];
    exampleMatches.slice(0, 2).forEach((match) => exampleSet.add(match.trim()));
  });

  return {
    keyConcepts: Array.from(conceptSet).slice(0, 14),
    definitions: Array.from(definitionSet).slice(0, 10),
    formulas: Array.from(formulaSet).slice(0, 10),
    examples: Array.from(exampleSet).slice(0, 10)
  };
}

/**
 * Build a unified context shape regardless of input mode.
 * @param {{
 * prompt: string,
 * normalizedSources: Array<{type: string, name: string, rawText: string, provenance?: { index?: number }}>,
 * sourceSummary?: any
 * }} normalizedRequest
 */
function buildLectureContext(normalizedRequest) {
  const prompt = normalizedRequest.prompt || '';
  const normalizedSources = Array.isArray(normalizedRequest.normalizedSources)
    ? normalizedRequest.normalizedSources
    : [];
  const hasFileEvidence = normalizedSources.some((source) => source.type === 'pdf' || source.type === 'image');
  const lowSignalPrompt = isLowSignalPrompt(prompt);

  let contextBudget = MAX_CONTEXT_CHARS;
  const allSourceChunks = normalizedSources
    .filter((source) => typeof source.rawText === 'string' && source.rawText.trim().length > 0)
    .flatMap((source, sourceIndex) => {
      const chunks = splitIntoChunks(source.rawText.trim(), MAX_CHUNK_CHARS);
      return chunks.map((chunk, chunkIndex) => ({
        id: `chunk_${sourceIndex + 1}_${chunkIndex + 1}`,
        text: chunk,
        sourceType: source.type || 'unknown',
        sourceName: source.name || `source_${sourceIndex + 1}`,
        sourceIndex: Number.isInteger(source?.provenance?.index) ? source.provenance.index : sourceIndex
      }));
    })
    .filter((chunk) => {
      if (contextBudget <= 0) return false;
      contextBudget -= chunk.text.length;
      return contextBudget >= -MAX_CHUNK_CHARS;
    });

  const evidenceChunks = allSourceChunks.filter((chunk) => chunk.sourceType !== 'prompt');
  const sourceChunks = evidenceChunks.length > 0 ? evidenceChunks : allSourceChunks;

  const heuristics = extractHeuristics(sourceChunks);
  const coverageGaps = [];
  if (!prompt) coverageGaps.push('No explicit prompt was provided; topic inferred from source text.');
  if (sourceChunks.length === 0) coverageGaps.push('No extracted source text available; context relies on prompt only.');

  const inferredTopicFromSource = sourceChunks[0] ? sourceChunks[0].text.slice(0, 80) : '';
  const shouldPreferSourceTopic = hasFileEvidence && lowSignalPrompt && inferredTopicFromSource;
  const resolvedTopic = shouldPreferSourceTopic ? inferredTopicFromSource : (prompt || inferredTopicFromSource);

  if (shouldPreferSourceTopic) {
    coverageGaps.push('Prompt was low-signal; lecture topic anchored to extracted source material.');
  }

  return {
    topic: resolvedTopic,
    promptText: prompt,
    learningObjectives: prompt && !shouldPreferSourceTopic
      ? [`Understand and explain: ${prompt}`]
      : ['Summarize the uploaded material with clear conceptual progression.'],
    keyConcepts: heuristics.keyConcepts,
    definitions: heuristics.definitions,
    formulas: heuristics.formulas,
    examples: heuristics.examples,
    sourceChunks,
    coverageGaps,
    sourceSummary: normalizedRequest.sourceSummary || {}
  };
}

module.exports = {
  buildLectureContext,
  __private: {
    splitIntoChunks,
    extractHeuristics,
    isLowSignalPrompt,
    MAX_CHUNK_CHARS,
    MAX_CONTEXT_CHARS
  }
};
