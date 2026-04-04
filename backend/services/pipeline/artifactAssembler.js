require('./contracts');

function normalizeSnapshotText(value, maxLength = 900) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function toStringArray(input, limit = 16) {
  if (!Array.isArray(input)) return [];
  const values = [];
  input.forEach((item) => {
    const normalized = normalizeSnapshotText(item, 220);
    if (!normalized) return;
    values.push(normalized);
  });
  return values.slice(0, limit);
}

function buildArtifactContextSnapshot(context) {
  const value = context && typeof context === 'object' ? context : {};
  const topic = normalizeSnapshotText(value.topic, 220);
  const promptText = normalizeSnapshotText(value.promptText, 500);
  const sourceChunks = Array.isArray(value.sourceChunks)
    ? value.sourceChunks.slice(0, 10).map((chunk, idx) => ({
      id: String(chunk?.id || `chunk_${idx + 1}`),
      sourceType: String(chunk?.sourceType || 'unknown'),
      sourceName: normalizeSnapshotText(chunk?.sourceName || `source_${idx + 1}`, 120) || `source_${idx + 1}`,
      text: normalizeSnapshotText(chunk?.text, 900)
    })).filter((chunk) => chunk.text)
    : [];

  if (!topic && !promptText && sourceChunks.length === 0) {
    return null;
  }

  return {
    topic: topic || promptText || 'Generated Lecture',
    promptText,
    learningObjectives: toStringArray(value.learningObjectives, 8),
    keyConcepts: toStringArray(value.keyConcepts, 14),
    definitions: toStringArray(value.definitions, 12),
    formulas: toStringArray(value.formulas, 12),
    examples: toStringArray(value.examples, 12),
    coverageGaps: toStringArray(value.coverageGaps, 10),
    sourceSummary: value.sourceSummary || {},
    sourceChunks
  };
}

/**
 * Assemble response payload while preserving backward-compatible lecture fields.
 * @param {{
 * requestId: string,
 * inputMode: string,
 * warnings: string[],
 * stageTimingsMs: Record<string, number>,
 * context?: Object,
 * lecture: { narration: string, manimCode: string, title?: string, totalDuration?: number, scenes?: any[] },
 * videoPath: string,
 * audio?: { url?: string, manifestUrl?: string, totalDurationSec?: number, segments?: any[] }|null,
 * quiz: any[]|null,
 * flashcards: any[]|null,
 * sourceSummary?: any
 * }} params
 */
function assembleGenerationBundle(params) {
  const lecture = params.lecture || {};
  const artifactContext = buildArtifactContextSnapshot(params.context);
  const audio = params.audio && typeof params.audio === 'object'
    ? {
      url: params.audio.url || '',
      manifestUrl: params.audio.manifestUrl || '',
      muxedVideoUrl: params.audio.muxedVideoUrl || '',
      totalDurationSec: params.audio.totalDurationSec || params.audio.audioDurationSec || 0,
      originalVideoDurationSec: params.audio.originalVideoDurationSec || 0,
      segments: Array.isArray(params.audio.segments) ? params.audio.segments : []
    }
    : null;
  return {
    success: true,
    requestId: params.requestId,
    inputMode: params.inputMode || 'text_only',
    warnings: Array.isArray(params.warnings) ? params.warnings : [],
    sourceSummary: params.sourceSummary || {},
    metadata: {
      requestId: params.requestId,
      inputMode: params.inputMode || 'text_only',
      stageTimingsMs: params.stageTimingsMs || {},
      artifactContext
    },
    videoUrl: `/videos/${require('path').basename(params.videoPath)}`,
    narration: lecture.narration,
    manimCode: lecture.manimCode,
    title: lecture.title || 'Generated Lecture',
    totalDuration: lecture.totalDuration || 90,
    scenes: lecture.scenes || [],
    audio,
    quiz: Array.isArray(params.quiz) ? params.quiz : [],
    flashcards: Array.isArray(params.flashcards) ? params.flashcards : []
  };
}

module.exports = {
  assembleGenerationBundle,
  __private: {
    normalizeSnapshotText,
    toStringArray,
    buildArtifactContextSnapshot
  }
};
