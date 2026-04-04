/**
 * @typedef {Object} NormalizedSource
 * @property {'prompt'|'pdf'|'image'|'unknown'} type
 * @property {string} name
 * @property {string} rawText
 * @property {{ kind: string, index?: number, filename?: string }} provenance
 * @property {number} confidence
 * @property {string[]} warnings
 */

/**
 * @typedef {Object} LectureContext
 * @property {string} topic
 * @property {string} promptText
 * @property {string[]} learningObjectives
 * @property {Array<{ id: string, text: string, sourceType: string, sourceName: string }>} sourceChunks
 * @property {string[]} keyConcepts
 * @property {string[]} formulas
 * @property {string[]} definitions
 * @property {string[]} examples
 * @property {string[]} coverageGaps
 * @property {Object} sourceSummary
 */

/**
 * @typedef {Object} AudioBundle
 * @property {string} [url]
 * @property {string} [manifestUrl]
 * @property {number} [totalDurationSec]
 * @property {Object[]} [segments]
 */

/**
 * @typedef {Object} GenerationBundle
 * @property {Object} lecture
 * @property {AudioBundle|null} [audio]
 * @property {Object[]} quiz
 * @property {Object[]} flashcards
 * @property {Object} sourceSummary
 * @property {string[]} warnings
 * @property {{ requestId: string, inputMode: string, stageTimingsMs: Record<string, number> }} metadata
 */

module.exports = {};
