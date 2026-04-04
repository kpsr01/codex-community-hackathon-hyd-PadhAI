const express = require('express');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { FIVE_MINUTES_MS } = require('../config/timeouts');
const { createStructuredResponse, getOpenAIConfig } = require('../services/openai/apiClient');
const { normalizeGenerateRequest } = require('../services/pipeline/requestNormalizer');
const { buildLectureContext } = require('../services/pipeline/contextBuilder');
const { enrichLectureContext } = require('../services/pipeline/contextEnricher');
const { assembleGenerationBundle } = require('../services/pipeline/artifactAssembler');
const { generateQuizFromContext, generateFlashcardsFromContext } = require('../services/pipeline/studyArtifactStubs');
const { createLectureOrchestrator } = require('../services/pipeline/lectureOrchestrator');
const { synthesizeLectureAudio, muxLectureVideo } = require('../services/audio/lectureAudio');

const router = express.Router();
const LECTURE_MODEL = getOpenAIConfig().coreModel;
const DEFAULT_LECTURE_TIMEOUT_MS = FIVE_MINUTES_MS;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024,
    files: 5
  }
});

// Remove previously generated transient artifacts to keep repo clean
function cleanupOldFiles() {
  try {
    const videosDir = path.join(__dirname, '..', 'videos');
    const tempDir = path.join(__dirname, '..', 'temp');
    const audioDir = path.join(__dirname, '..', 'audio');
    
    // Clean up old generated videos (keep only dummy and fallback)
    if (fs.existsSync(videosDir)) {
      const files = fs.readdirSync(videosDir);
      files.forEach(file => {
        if (file.startsWith('lecture_') && file.endsWith('.mp4')) {
          const filePath = path.join(videosDir, file);
          fs.unlinkSync(filePath);
          console.log('Cleaned up old video:', file);
        }
      });
    }
    
    // Clean up temp directory
    if (fs.existsSync(tempDir)) {
      const files = fs.readdirSync(tempDir);
      files.forEach(file => {
        const filePath = path.join(tempDir, file);
        try {
          if (file.startsWith('lecture_') && file.endsWith('.py')) {
            fs.unlinkSync(filePath);
            console.log('Cleaned up old Python file:', file);
          } else if (file === '__pycache__' || file === 'media') {
            fs.rmSync(filePath, { recursive: true, force: true });
            console.log('Cleaned up directory:', file);
          }
        } catch (e) {
          if (e && e.code === 'EBUSY') {
            // Ignore locked files on Windows; they'll be cleaned later
          } else {
            throw e;
          }
        }
      });
    }

    if (fs.existsSync(audioDir)) {
      const files = fs.readdirSync(audioDir);
      files.forEach((file) => {
        if (file.startsWith('lecture_') && (file.endsWith('.wav') || file.endsWith('.json'))) {
          fs.unlinkSync(path.join(audioDir, file));
        }
      });
    }
    
  } catch (error) {
    console.error('Error during cleanup:', error.message);
  }
}

function validatePrompt(prompt) {
  if (typeof prompt !== 'string') {
    return;
  }
  if (prompt.length > 1200) {
    const err = new Error('Prompt too long (max 1200 chars)');
    err.status = 413;
    throw err;
  }
  if (/import\s+os|subprocess|open\(|exec\(|eval\(/i.test(prompt)) {
    const err = new Error('Prompt contains disallowed patterns');
    err.status = 400;
    throw err;
  }
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBooleanInput(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function normalizeArtifactContextFromBody(body) {
  const payload = body && typeof body === 'object' ? body : {};
  const prompt = typeof payload.prompt === 'string' ? payload.prompt.trim() : '';
  const context = resolveContextLikeInput(payload.context || {});
  const sourceChunks = Array.isArray(context.sourceChunks)
    ? context.sourceChunks
      .map((chunk, index) => ({
        id: String(chunk?.id || `chunk_${index + 1}`),
        sourceType: String(chunk?.sourceType || 'unknown'),
        sourceName: truncateText(chunk?.sourceName || `source_${index + 1}`, 120) || `source_${index + 1}`,
        text: truncateText(chunk?.text || '', 1200)
      }))
      .filter((chunk) => normalizeWhitespace(chunk.text))
    : [];

  if (sourceChunks.length === 0 && prompt) {
    sourceChunks.push({
      id: 'prompt_1',
      sourceType: 'prompt',
      sourceName: 'prompt',
      text: truncateText(prompt, 1200)
    });
  }

  return {
    topic: context.topic || prompt || '',
    promptText: context.promptText || prompt || '',
    keyConcepts: Array.isArray(context.keyConcepts) ? context.keyConcepts : [],
    definitions: Array.isArray(context.definitions) ? context.definitions : [],
    formulas: Array.isArray(context.formulas) ? context.formulas : [],
    examples: Array.isArray(context.examples) ? context.examples : [],
    coverageGaps: Array.isArray(payload.context?.coverageGaps) ? payload.context.coverageGaps : [],
    sourceSummary: payload.context?.sourceSummary || {},
    sourceChunks
  };
}

const orchestrator = createLectureOrchestrator({
  normalizeRequest: normalizeGenerateRequest,
  buildContext: buildLectureContext,
  enrichContext: enrichLectureContext,
  generateLecture: async (context) => {
    cleanupOldFiles();
    return generateContent(context);
  },
  renderVideo: async (lecture, context) => executeManimCode(lecture.manimCode, {
    fallbackInput: {
      ...(context || {}),
      title: lecture?.title || (context && context.topic) || '',
      narration: lecture?.narration || ''
    }
  }),
  synthesizeAudio: async (lecture, context, { requestId }) => synthesizeLectureAudio(lecture, context, { requestId }),
  muxVideo: async ({ videoPath, audio, requestId }) => muxLectureVideo({ videoPath, audio, requestId }),
  assembleArtifacts: assembleGenerationBundle,
  generateQuiz: generateQuizFromContext,
  generateFlashcards: generateFlashcardsFromContext
});

// Generate lecture endpoint
router.post('/', upload.any(), async (req, res) => {
  const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  try {
    const prompt = (req.body && typeof req.body.prompt === 'string') ? req.body.prompt.trim() : '';
    validatePrompt(prompt);
    if (!prompt && (!Array.isArray(req.files) || req.files.length === 0)) {
      return res.status(400).json({ error: 'Prompt is required' });
    }
    req.requestId = requestId;

    const pipelineResponse = await orchestrator.run({
      req,
      requestId
    });

    res.json(pipelineResponse);
  } catch (error) {
    console.error(`[pipeline:${requestId}] Error generating lecture in pipeline:`, error.message);
    const statusCode = error.status || 500;
    res.status(statusCode).json({
      error: 'Failed to generate lecture',
      details: error.message,
      warnings: Array.isArray(error.details) ? error.details : []
    });
  }
});

router.post('/artifacts', async (req, res) => {
  const requestId = `art_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  try {
    const generateQuiz = parseBooleanInput(req.body?.generateQuiz, false);
    const generateFlashcards = parseBooleanInput(req.body?.generateFlashcards, false);

    if (!generateQuiz && !generateFlashcards) {
      return res.status(400).json({
        error: 'Select at least one artifact to generate.',
        requestId
      });
    }

    const context = normalizeArtifactContextFromBody(req.body || {});
    const hasUsableContext = Boolean(
      normalizeWhitespace(context.topic)
      || normalizeWhitespace(context.promptText)
      || (Array.isArray(context.sourceChunks) && context.sourceChunks.length > 0)
    );

    if (!hasUsableContext) {
      return res.status(400).json({
        error: 'No reusable context was provided for artifact generation.',
        requestId
      });
    }

    const warnings = [];
    let quiz = [];
    let flashcards = [];

    if (generateQuiz) {
      try {
        quiz = await generateQuizFromContext(context);
      } catch (error) {
        warnings.push(`Quiz generation failed: ${error.message}`);
      }
    }

    if (generateFlashcards) {
      try {
        flashcards = await generateFlashcardsFromContext(context);
      } catch (error) {
        warnings.push(`Flashcard generation failed: ${error.message}`);
      }
    }

    return res.json({
      success: true,
      requestId,
      quiz,
      flashcards,
      warnings
    });
  } catch (error) {
    console.error(`[artifacts:${requestId}] Error generating study artifacts:`, error.message);
    return res.status(500).json({
      error: 'Failed to generate study artifacts.',
      details: error.message,
      requestId
    });
  }
});

function normalizeLectureText(text) {
  return String(text || '')
    .replace(/\u2018|\u2019/g, "'")
    .replace(/\u201C|\u201D/g, '"')
    .replace(/\u2013|\u2014|\u2015/g, '-')
    .replace(/\u00a0/g, ' ')
    .trim();
}

function stripPauseMarkers(text) {
  return String(text || '')
    .replace(/\[PAUSE=\d+\.?\d*\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeWhitespace(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function truncateText(text, maxLength) {
  const value = normalizeWhitespace(text);
  if (!value) return '';
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function firstSentence(text, maxLength = 160) {
  const value = normalizeWhitespace(text);
  if (!value) return '';
  const match = value.match(/.+?[.!?](?:\s|$)/);
  return truncateText(match ? match[0] : value, maxLength);
}

function toSentence(text) {
  const value = normalizeWhitespace(text);
  if (!value) return '';
  return /[.!?]$/.test(value) ? value : `${value}.`;
}

function escapeForPythonText(text, maxLength = 48) {
  return truncateText(text, maxLength)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'");
}

function dedupeStrings(items, limit) {
  const seen = new Set();
  const result = [];

  for (const item of items) {
    const value = normalizeWhitespace(item);
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
    if (result.length >= limit) break;
  }

  return result;
}

function compactConceptLabel(text, fallbackLabel) {
  const normalized = truncateText(
    String(text || '')
      .replace(/^[\s,;:.-]+/, '')
      .replace(/\s*[-:|].*$/, '')
      .replace(/\s+/g, ' '),
    28
  );
  return normalized || fallbackLabel;
}

function estimateNarrationDurationSeconds(text) {
  const cleaned = stripPauseMarkers(text || '');
  const words = cleaned.split(/\s+/).filter(Boolean).length;
  if (words === 0) return 0;
  return words / 2.5;
}

function deriveSceneDuration(scene) {
  const candidates = [
    Number(scene?.manim_animation_duration_sec),
    Number(scene?.estimated_narration_duration_sec),
    Number(scene?.total_scene_duration_sec)
  ];
  const known = candidates.find((value) => Number.isFinite(value) && value > 0);
  if (known) return known;

  const inferredNarration = estimateNarrationDurationSeconds(
    scene?.narration_script || (Array.isArray(scene?.narration_segments) ? scene.narration_segments.join(' ') : '')
  );
  return Math.max(8, inferredNarration);
}

function buildDeterministicSceneScaffold(parsedContent, input) {
  const title = escapeForPythonText(resolveLectureTitle(input), 40);
  const scenes = Array.isArray(parsedContent?.scenes) ? parsedContent.scenes.slice(0, 4) : [];
  const palette = ['TEAL', 'GREEN', 'BLUE', 'YELLOW'];
  const baseSceneRuntime = 5.8;

  const lines = [
    'from manim import *',
    '',
    'class GeneratedScene(Scene):',
    '    def construct(self):',
    `        intro = Text('${title}', font_size=42, color=BLUE).to_edge(UP)`,
    '        self.play(Write(intro), run_time=1.8)',
    '        self.wait(0.8)',
    '        self.play(FadeOut(intro), run_time=0.8)'
  ];

  scenes.forEach((scene, idx) => {
    const sceneNumber = idx + 1;
    const color = palette[idx % palette.length];
    const summaryLabel = escapeForPythonText(
      compactConceptLabel(scene?.scene_summary, `Concept ${sceneNumber}`),
      34
    );
    const detailLabel = escapeForPythonText(
      firstSentence(scene?.narration_script || scene?.scene_summary || `Scene ${sceneNumber}`, 56),
      56
    );
    const sceneTargetDuration = Math.max(8, deriveSceneDuration(scene));
    const extraWait = Math.max(0.6, sceneTargetDuration - baseSceneRuntime);

    lines.push(`        # Deterministic scene scaffold ${sceneNumber}`);
    lines.push(`        scene_title_${sceneNumber} = Text('Scene ${sceneNumber}: ${summaryLabel}', font_size=30, color=BLUE).to_edge(UP)`);
    lines.push(`        panel_${sceneNumber} = Rectangle(width=10, height=3.2, color=${color}, fill_opacity=0.16)`);
    lines.push(`        key_${sceneNumber} = Text('${summaryLabel}', font_size=34).move_to(panel_${sceneNumber}.get_center() + UP * 0.42)`);
    lines.push(`        detail_${sceneNumber} = Text('${detailLabel}', font_size=24, color=YELLOW).next_to(key_${sceneNumber}, DOWN, buff=0.3)`);
    lines.push(`        arrow_${sceneNumber} = Arrow(start=LEFT * 4.2, end=LEFT * 1.2, color=${color})`);
    lines.push(`        self.play(Write(scene_title_${sceneNumber}), run_time=1.0)`);
    lines.push(`        self.play(Create(panel_${sceneNumber}), FadeIn(key_${sceneNumber}, shift=UP * 0.2), run_time=1.4)`);
    lines.push(`        self.play(Write(detail_${sceneNumber}), Create(arrow_${sceneNumber}), run_time=1.3)`);
    lines.push(`        self.play(Indicate(key_${sceneNumber}), run_time=0.9)`);
    lines.push(`        self.wait(${extraWait.toFixed(2)})`);
    lines.push(
      `        self.play(FadeOut(scene_title_${sceneNumber}), FadeOut(panel_${sceneNumber}), FadeOut(key_${sceneNumber}), FadeOut(detail_${sceneNumber}), FadeOut(arrow_${sceneNumber}), run_time=1.2)`
    );
  });

  lines.push("        outro = Text('Review key ideas in transcript and quiz.', font_size=26, color=BLUE).to_edge(DOWN)");
  lines.push('        self.play(Write(outro), run_time=1.5)');
  lines.push('        self.wait(1.5)');

  return `${lines.join('\n')}\n`;
}

function isVisuallySparseManimCode(code, sceneCount) {
  const value = String(code || '');
  const playCount = (value.match(/\bself\.play\(/g) || []).length;
  const animCount = (value.match(/\b(Create|Write|FadeIn|Transform|Indicate|Circumscribe)\(/g) || []).length;
  const textCount = (value.match(/\bText\(/g) || []).length;
  const expectedScenes = Math.max(1, Number(sceneCount) || 1);

  return (
    playCount < expectedScenes * 2
    || animCount < expectedScenes * 2
    || textCount < expectedScenes + 1
  );
}

function resolveContextLikeInput(input) {
  if (typeof input === 'string') {
    return {
      topic: input,
      promptText: input,
      keyConcepts: [],
      definitions: [],
      formulas: [],
      examples: [],
      sourceChunks: input
        ? [{ id: 'prompt_1', sourceType: 'prompt', sourceName: 'prompt', text: input }]
        : []
    };
  }

  const context = input || {};
  return {
    topic: context.topic || '',
    promptText: context.promptText || '',
    keyConcepts: Array.isArray(context.keyConcepts) ? context.keyConcepts : [],
    definitions: Array.isArray(context.definitions) ? context.definitions : [],
    formulas: Array.isArray(context.formulas) ? context.formulas : [],
    examples: Array.isArray(context.examples) ? context.examples : [],
    sourceChunks: Array.isArray(context.sourceChunks) ? context.sourceChunks : [],
    sourceSummary: context.sourceSummary || {}
  };
}

function resolveLectureGenerationMode(input) {
  const context = resolveContextLikeInput(input);
  const sourceChunks = Array.isArray(context.sourceChunks) ? context.sourceChunks : [];
  const hasExternalSources = sourceChunks.some((chunk) => (
    normalizeWhitespace(chunk?.text || '')
    && (chunk?.sourceType || 'unknown') !== 'prompt'
  ));

  return hasExternalSources ? 'grounded' : 'expert';
}

function resolveLectureTitle(input) {
  const context = resolveContextLikeInput(input);
  const candidates = [
    context.topic,
    context.keyConcepts[0],
    firstSentence(context.sourceChunks[0]?.text || '', 56),
    context.promptText
  ];

  const title = candidates.find((candidate) => normalizeWhitespace(candidate));
  return truncateText(title || 'Generated Lecture', 56);
}

function collectFallbackHighlights(input) {
  const context = resolveContextLikeInput(input);
  const candidates = [
    ...context.keyConcepts,
    ...context.definitions.map((item) => firstSentence(item, 140)),
    ...context.formulas.map((item) => truncateText(item, 90)),
    ...context.examples.map((item) => firstSentence(item, 140)),
    ...context.sourceChunks.map((chunk) => firstSentence(chunk.text, 140))
  ];

  return dedupeStrings(candidates, 5);
}

function createGroundedFallbackLecture(input, reason = '') {
  const context = resolveContextLikeInput(input);
  const title = resolveLectureTitle(context);
  const highlights = collectFallbackHighlights(context);
  const labels = dedupeStrings(
    [
      ...context.keyConcepts,
      ...highlights,
      title
    ].map((item, idx) => compactConceptLabel(item, `Key Idea ${idx + 1}`)),
    3
  );

  while (labels.length < 3) {
    labels.push(`Key Idea ${labels.length + 1}`);
  }

  const hasFileEvidence = context.sourceChunks.some((chunk) => chunk.sourceType === 'pdf' || chunk.sourceType === 'image');
  const intro = hasFileEvidence
    ? `This lecture is grounded in the uploaded material about ${title}.`
    : `This lecture explains ${title}.`;
  const focusInstruction = context.promptText && !/^explain\s+(this|these|the)\s+(concept|concepts|topic|topics)\b/i.test(context.promptText)
    ? `It follows the requested focus: ${truncateText(context.promptText, 140)}.`
    : '';
  const body = highlights.slice(0, 4).map((item) => toSentence(item));
  if (body.length === 0 && title) {
    body.push(`The main ideas center on ${title}.`);
  }
  const conclusion = hasFileEvidence
    ? 'Use the transcript, quiz, and flashcards together to review the uploaded concepts.'
    : 'Review the key ideas in the transcript to reinforce the explanation.';
  const narration = [intro, focusInstruction, ...body, conclusion]
    .filter(Boolean)
    .join(' ');
  const totalDuration = Math.max(45, Math.round(stripPauseMarkers(narration).split(/\s+/).filter(Boolean).length / 2.4));

  return {
    title,
    narration,
    manimCode: generateFallbackManimCode({
      title,
      subtitle: hasFileEvidence ? 'Source-grounded overview' : 'Concept overview',
      conceptLabels: labels
    }),
    totalDuration,
    scenes: [{
      scene_number: 1,
      scene_summary: 'Fallback overview',
      narration_script: narration,
      estimated_narration_duration_sec: totalDuration,
      manim_animation_duration_sec: totalDuration
    }],
    warnings: [
      reason
        ? `Lecture generation used a fallback: ${reason}`
        : 'Lecture generation used a fallback.'
    ]
  };
}

// Function to generate fallback Manim code
function generateFallbackManimCode(input = {}) {
  const title = escapeForPythonText(input.title || 'Generated Lecture', 40);
  const subtitle = escapeForPythonText(input.subtitle || 'Concept overview', 42);
  const conceptLabels = Array.isArray(input.conceptLabels) ? input.conceptLabels : [];
  const label1 = escapeForPythonText(compactConceptLabel(conceptLabels[0], 'Key Idea 1'), 24);
  const label2 = escapeForPythonText(compactConceptLabel(conceptLabels[1], 'Key Idea 2'), 24);
  const label3 = escapeForPythonText(compactConceptLabel(conceptLabels[2], 'Key Idea 3'), 24);

  return `from manim import *

class GeneratedScene(Scene):
    def construct(self):
        title = Text('${title}', font_size=42, color=BLUE).to_edge(UP)
        subtitle = Text('${subtitle}', font_size=24, color=WHITE).next_to(title, DOWN)
        self.play(Write(title), FadeIn(subtitle, shift=DOWN * 0.2), run_time=2.5)
        self.wait(0.8)

        box1 = Rectangle(width=6.2, height=1.0, color=TEAL, fill_opacity=0.15)
        box2 = Rectangle(width=6.2, height=1.0, color=GREEN, fill_opacity=0.15)
        box3 = Rectangle(width=6.2, height=1.0, color=YELLOW, fill_opacity=0.15)
        boxes = VGroup(box1, box2, box3).arrange(DOWN, buff=0.45).move_to(ORIGIN)

        text1 = Text('${label1}', font_size=24).move_to(box1)
        text2 = Text('${label2}', font_size=24).move_to(box2)
        text3 = Text('${label3}', font_size=24).move_to(box3)

        self.play(Create(box1), Write(text1), run_time=1.6)
        self.wait(0.8)
        self.play(Create(box2), Write(text2), run_time=1.6)
        self.wait(0.8)
        self.play(Create(box3), Write(text3), run_time=1.6)
        self.wait(1.4)

        closing = Text('Review the transcript for detail.', font_size=26, color=BLUE).to_edge(DOWN)
        self.play(
            FadeOut(box1), FadeOut(box2), FadeOut(box3),
            FadeOut(text1), FadeOut(text2), FadeOut(text3),
            Write(closing),
            run_time=1.8
        )
        self.wait(1.4)`;
}

function buildLectureExperienceBrief() {
  return [
    'Target experience: the final rendered output should feel like a polished animated lecture, not narration over static slides.',
    'Design the lecture like an explainer-video director: establish intuition, reveal structure, animate relationships, then consolidate the takeaway.',
    'Every scene must contain meaningful visual teaching aids such as diagrams, process flows, comparison layouts, labeled structures, stepwise breakdowns, or formula decompositions built from simple Manim primitives.',
    'Use motion with pedagogical intent: introduce a frame, progressively reveal the important parts, emphasize or transform the key relationship, then clear the stage cleanly.',
    'Keep the visual language consistent across scenes so the video feels seamless: reuse a stable color story, layout logic, and pacing.',
    'Avoid scenes that are mostly a title card or a single static label. The viewer should continually see the concept being built, connected, highlighted, or transformed.',
    'Use narration for depth and explanation, and use short on-screen labels to anchor what the viewer is seeing.'
  ];
}

function buildWorkingManimEnvironmentBrief() {
  return [
    'Working render environment: core `manim` is available via `from manim import *`.',
    'There are no project-specific Manim extensions or custom helper libraries available to you.',
    'Installed Python libraries confirmed in this environment include `manim`, `numpy`, `PIL`, and `networkx`.',
    'Do not use or reference non-installed Manim plugins such as `manim_slides`, `manim_voiceover`, `manim_physics`, `manim_chemistry`, `manim_ml`, or any other `manim_*` extension.',
    'For maximum compatibility, stay inside core Manim primitives and animations and avoid external imports entirely unless the schema explicitly asks for them.'
  ];
}

function buildLectureUserPrompt(input, options = {}) {
  const generationMode = options.generationMode || resolveLectureGenerationMode(input);
  const context = typeof input === 'string'
    ? {
      topic: input,
      promptText: input,
      learningObjectives: [],
      keyConcepts: [],
      definitions: [],
      formulas: [],
      examples: [],
      sourceSummary: {},
      sourceChunks: input
        ? [{ id: 'prompt_1', sourceType: 'prompt', sourceName: 'prompt', text: input }]
        : [],
      coverageGaps: []
    }
    : (input || {});
  const allChunks = Array.isArray(context.sourceChunks) ? context.sourceChunks : [];
  const nonPromptChunks = allChunks.filter((chunk) => chunk.sourceType !== 'prompt');
  const selectedChunks = (nonPromptChunks.length > 0 ? nonPromptChunks : allChunks).slice(0, 8);

  if (generationMode === 'expert') {
    const lectureRequest = {
      topic: context.topic || context.promptText || '',
      promptText: context.promptText || '',
      learningObjectives: Array.isArray(context.learningObjectives) ? context.learningObjectives : [],
      keyConcepts: Array.isArray(context.keyConcepts) ? context.keyConcepts : [],
      definitions: Array.isArray(context.definitions) ? context.definitions : [],
      formulas: Array.isArray(context.formulas) ? context.formulas : [],
      examples: Array.isArray(context.examples) ? context.examples : [],
      sourceChunks: selectedChunks.map((chunk) => ({
        id: chunk.id,
        sourceType: chunk.sourceType,
        sourceName: chunk.sourceName,
        text: truncateText(chunk.text, 900)
      }))
    };

    return [
      'Create a complete educational lecture from this LectureRequest JSON.',
      ...buildLectureExperienceBrief(),
      ...buildWorkingManimEnvironmentBrief(),
      'No external source files were provided for strict grounding, so rely on your subject expertise.',
      'Do not include meta narration about missing context, source summaries, coverage gaps, or absent documents.',
      'Use accurate definitions, formulas, and examples where they improve understanding.',
      'Make the visuals feel lecture-grade: prefer explanation through diagrams, arrows, before/after changes, comparisons, and staged reveals instead of decorative motion.',
      'Do not paste long text into Text(...) objects; convert detail into narration and keep the screen readable.',
      'Prefer 3-4 visually obvious scenes that could safely render in Manim without advanced features.',
      'Aim for a strong lecture arc across the 3-4 scenes: hook or setup, core mechanism or structure, worked explanation or comparison, then synthesis or recap.',
      'Each scene should have 2 to 4 visual beats so the animation keeps evolving while the narration speaks.',
      'Each scene should be self-contained: create its own objects, animate them, and fade them out in the same scene.',
      JSON.stringify(lectureRequest, null, 2)
    ].join('\n\n');
  }

  const lectureContext = {
    topic: context.topic || '',
    promptText: context.promptText || '',
    learningObjectives: Array.isArray(context.learningObjectives) ? context.learningObjectives : [],
    keyConcepts: Array.isArray(context.keyConcepts) ? context.keyConcepts : [],
    definitions: Array.isArray(context.definitions) ? context.definitions : [],
    formulas: Array.isArray(context.formulas) ? context.formulas : [],
    examples: Array.isArray(context.examples) ? context.examples : [],
    sourceSummary: context.sourceSummary || {},
    sourceChunks: selectedChunks.map((chunk) => ({
      id: chunk.id,
      sourceType: chunk.sourceType,
      sourceName: chunk.sourceName,
      text: truncateText(chunk.text, 900)
    })),
    coverageGaps: Array.isArray(context.coverageGaps) ? context.coverageGaps : []
  };

  return [
    'Create a lecture strictly grounded in this LectureContext JSON.',
    ...buildLectureExperienceBrief(),
    ...buildWorkingManimEnvironmentBrief(),
    'Treat promptText as intent/instruction only; factual content must come from sourceChunks.',
    'If promptText is generic (e.g., "explain these concepts"), ignore it as a factual source and use sourceChunks.',
    'Do not invent facts beyond the provided material and prompt.',
    'Make the visuals feel lecture-grade: use the grounded concepts to build diagrams, labeled relationships, process flows, comparisons, and staged reveals instead of generic title cards.',
    'Do not paste long source text into Text(...) objects; distill the material into short visual labels and keep factual detail in narration.',
    'Prefer 3-4 visually obvious scenes that could safely render in Manim without advanced features.',
    'Aim for a strong lecture arc across the 3-4 scenes: setup from the source material, core explanation, grounded example or comparison, then synthesis or recap.',
    'Each scene should have 2 to 4 visual beats so the animation keeps evolving while the narration speaks.',
    'Each scene should be self-contained: create its own objects, animate them, and fade them out in the same scene.',
    'If context is sparse, stay grounded, simplify the visuals around the available evidence, and state assumptions in narration instead of fabricating details.',
    JSON.stringify(lectureContext, null, 2)
  ].join('\n\n');
}

function buildLectureSystemPrompt(options = {}) {
  const generationMode = options.generationMode || 'grounded';
  const groundingInstructions = generationMode === 'grounded'
    ? [
      'You will receive a LectureContext JSON object.',
      'Ground every factual statement in sourceChunks, definitions, formulas, or examples.',
      'Treat promptText as style or focus guidance only.',
      'If promptText is generic like "explain these concepts", ignore it as factual content and use sourceChunks instead.'
    ].join('\n')
    : [
      'You will receive a LectureRequest JSON object.',
      'Use your expertise to provide accurate educational content, even when no source files are attached.',
      'If sourceChunks are present, prioritize them while filling small gaps with standard background knowledge.',
      'Do not include meta statements about missing context, missing sources, coverage gaps, or limitations.'
    ].join('\n');

  return `You are Maestro, an educational video planner, lecture director, and senior Manim author.
Return one valid JSON object only. No markdown, no commentary, and no code fences.

${groundingInstructions}
Your job is to produce a lecture whose rendered video feels like a high-quality animated classroom explanation with synchronized narration, diagrams, and purposeful motion.
The viewer should feel like they are watching a real lecture unfold on screen, not listening to audio pasted over static slides.
Your highest priority is to produce Manim code that actually renders successfully in a basic backend environment while still feeling thoughtful, dynamic, and educational.
Do not optimize for flashy effects. Optimize for stable, visible, lecture-grade animation and clear visual teaching.
Runtime environment constraints:
- Use core Manim only, imported as \`from manim import *\`.
- No custom project helpers or Manim plugins are available.
- Confirmed available Python packages in this environment are \`manim\`, \`numpy\`, \`PIL\`, and \`networkx\`, but you should avoid external imports and solve the lecture with core Manim unless absolutely necessary.
- Do not use or mention unsupported plugins such as \`manim_slides\`, \`manim_voiceover\`, \`manim_physics\`, \`manim_chemistry\`, \`manim_ml\`, or any other \`manim_*\` extension.

Return this schema exactly:
{
  "title": "Concise lecture title",
  "total_estimated_duration_sec": 60,
  "manim_header": "from manim import *\\n\\nclass GeneratedScene(Scene):\\n    def construct(self):\\n",
  "scenes": [
    {
      "scene_number": 1,
      "scene_summary": "What this scene covers",
      "narration_script": "Narration for the scene.",
      "estimated_narration_duration_sec": 18,
      "manim_code_block": "        title = Text(\\\"Example\\\", font_size=40)\\n        self.play(Write(title), run_time=2.0)\\n        self.wait(2.0)",
      "manim_animation_duration_sec": 18
    }
  ],
  "manim_footer": "\\n        self.wait(2.0)\\n"
}

Requirements:
- Produce exactly 3 or 4 scenes with a clear concept flow.
- The full lecture should feel intentionally structured: setup, explanation, development, and recap. Adapt that arc to the topic, but preserve momentum.
- Keep labels short enough for Text(...) objects. Prefer 2 to 5 words on screen.
- If a concept is detailed, put the detail in narration and keep the visual label short.
- Do not use MathTex, Tex, SVGMobject, ImageMobject, Axes, NumberPlane, MovingCameraScene, ThreeDScene, or plugin-specific classes.
- Use only these Manim objects: Text, Circle, Square, Rectangle, Arrow, Line, VGroup, Dot, Brace.
- Use only these animation patterns: Create, Write, FadeIn, FadeOut, Transform, Indicate, Circumscribe, and .animate.
- Avoid camera animations, custom helper functions, external imports, advanced Manim features, and dynamic updaters.
- Each manim_code_block must be valid Python placed inside construct(self).
- Each scene must be self-contained. Do not rely on variables created in earlier scenes.
- Every scene must include a real visual explanation, not just a heading. Build simple but clear diagrams from the allowed primitives.
- Good visual patterns include: labeled diagrams, cause-and-effect arrows, stepwise flows, comparisons, before/after states, part-to-whole breakdowns, and formula or definition decompositions.
- Each scene should contain 2 to 4 visual beats: establish the frame, reveal components, emphasize or transform the key relationship, then exit cleanly.
- Use arrows, lines, braces, grouping, position changes, and color contrast to show relationships explicitly.
- Narration and animation must correspond closely. When narration introduces a part, relation, or change, the visuals should reveal or transform that exact idea at the same time.
- Every scene should create a few visible objects near the center of the frame and fade them out before ending.
- Keep everything on-screen: avoid large shifts, extreme coordinates, or giant objects.
- Prefer rectangles, arrows, lines, braces, grouped shapes, and short labels over complex geometry.
- Use plain ASCII text inside Text(...).
- Ensure manim_animation_duration_sec is at least estimated_narration_duration_sec by adding self.wait(...) padding.
- Avoid dead visual time: do not let a scene spend most of its duration on a static title card or a single unchanged object.
- The rendered video must never be a blank screen: every scene should visibly create, connect, highlight, or transform at least one object.
- Keep the JSON compact and parseable.`;
}

function buildLectureResponseSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      title: { type: 'string', minLength: 1 },
      total_estimated_duration_sec: { type: 'number', minimum: 1 },
      manim_header: { type: 'string', minLength: 1 },
      scenes: {
        type: 'array',
        minItems: 3,
        maxItems: 4,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            scene_number: { type: 'integer', minimum: 1 },
            scene_summary: { type: 'string', minLength: 1 },
            narration_script: { type: 'string' },
            estimated_narration_duration_sec: { type: 'number', minimum: 0 },
            manim_code_block: { type: 'string' },
            manim_animation_duration_sec: { type: 'number', minimum: 0 }
          },
          required: [
            'scene_number',
            'scene_summary',
            'narration_script',
            'estimated_narration_duration_sec',
            'manim_code_block',
            'manim_animation_duration_sec'
          ]
        }
      },
      manim_footer: { type: 'string', minLength: 1 }
    },
    required: ['title', 'total_estimated_duration_sec', 'manim_header', 'scenes', 'manim_footer']
  };
}

async function requestLectureCompletion(lecturePrompt, deps = {}, options = {}) {
  const generationMode = options.generationMode || 'grounded';
  const lectureTimeoutMs = parsePositiveInt(
    process.env.OPENAI_LECTURE_TIMEOUT_MS,
    DEFAULT_LECTURE_TIMEOUT_MS
  );
  const reasoningEffort = generationMode === 'expert' ? 'low' : 'medium';
  const verbosity = generationMode === 'expert' ? 'low' : 'medium';

  const { parsed } = await createStructuredResponse({
    model: deps.model || LECTURE_MODEL,
    instructions: buildLectureSystemPrompt(options),
    input: lecturePrompt,
    schema: buildLectureResponseSchema(),
    name: 'lecture_plan',
    reasoningEffort,
    verbosity,
    timeoutMs: deps.timeoutMs || lectureTimeoutMs
  }, deps);

  return parsed;
}

function extractBalancedJsonBlock(text) {
  const normalized = normalizeLectureText(text);
  const fenceMatch = normalized.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fenceMatch ? fenceMatch[1].trim() : normalized;

  for (let start = 0; start < candidate.length; start += 1) {
    const firstChar = candidate[start];
    if (firstChar !== '{' && firstChar !== '[') continue;

    const stack = [firstChar];
    let inString = false;
    let escaped = false;
    let valid = true;

    for (let index = start + 1; index < candidate.length; index += 1) {
      const char = candidate[index];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === '\\') {
          escaped = true;
        } else if (char === '"') {
          inString = false;
        }
        continue;
      }

      if (char === '"') {
        inString = true;
        continue;
      }

      if (char === '{' || char === '[') {
        stack.push(char);
        continue;
      }

      if (char === '}' || char === ']') {
        const expected = char === '}' ? '{' : '[';
        if (stack[stack.length - 1] !== expected) {
          valid = false;
          break;
        }
        stack.pop();
        if (stack.length === 0) {
          return candidate.slice(start, index + 1);
        }
      }
    }

    if (!valid) {
      continue;
    }
  }

  return '';
}

function parseLectureJson(content) {
  const normalized = normalizeLectureText(content);
  const extracted = extractBalancedJsonBlock(normalized);
  const candidates = [];

  if (normalized) candidates.push(normalized);
  if (extracted && extracted !== normalized) candidates.push(extracted);

  let lastError;
  for (const candidate of candidates) {
    const variants = [candidate, candidate.replace(/,\s*([}\]])/g, '$1')];
    for (const variant of variants) {
      try {
        return JSON.parse(variant);
      } catch (error) {
        lastError = error;
      }
    }
  }

  throw new Error(`Could not parse lecture JSON: ${lastError?.message || 'Unknown parse error'}`);
}

function buildLectureFromParsedContent(parsedContent, input) {
  if (parsedContent && typeof parsedContent.manimCode === 'string') {
    const directNarration = stripPauseMarkers(parsedContent.narration || parsedContent.narration_script || '');
    return {
      title: parsedContent.title || resolveLectureTitle(input),
      narration: directNarration || createGroundedFallbackLecture(input).narration,
      manimCode: parsedContent.manimCode.trim(),
      totalDuration: parsedContent.total_estimated_duration_sec || parsedContent.totalDuration || 90,
      scenes: Array.isArray(parsedContent.scenes) ? parsedContent.scenes : [],
      warnings: []
    };
  }

  if (!parsedContent || !Array.isArray(parsedContent.scenes)) {
    return createGroundedFallbackLecture(input, 'Lecture JSON was missing the scenes array.');
  }

  const header = parsedContent.manim_header || 'from manim import *\n\nclass GeneratedScene(Scene):\n    def construct(self):\n';
  const footer = parsedContent.manim_footer || '\n        self.wait(2.0)\n';
  let fullNarration = '';
  const assembledCodeParts = [header];
  let hasRenderableCode = false;

  const normalizeBlock = (block) => {
    if (!block) return '';
    const rawLines = String(block).replace(/\r\n/g, '\n').split('\n');
    while (rawLines.length && rawLines[0].trim() === '') rawLines.shift();
    while (rawLines.length && rawLines[rawLines.length - 1].trim() === '') rawLines.pop();
    if (!rawLines.length) return '';

    const converted = rawLines.map((line) => line.replace(/\t/g, '    '));
    let minIndent = Infinity;
    converted.forEach((line) => {
      if (line.trim() === '') return;
      const leading = line.match(/^(\s*)/)[0];
      minIndent = Math.min(minIndent, leading.length);
    });
    if (!Number.isFinite(minIndent)) minIndent = 0;

    const baseIndent = 8;
    return converted.map((line) => {
      if (line.trim() === '') return '';
      const leading = line.match(/^(\s*)/)[0].length;
      const relative = Math.max(0, leading - minIndent);
      return `${' '.repeat(baseIndent + relative)}${line.trimStart()}`;
    }).join('\n');
  };

  parsedContent.scenes.forEach((scene) => {
    assembledCodeParts.push(`        # Scene ${scene.scene_number || '?'}: ${scene.scene_summary || ''}`);

    if (Array.isArray(scene.shots)) {
      scene.shots.forEach((shot) => {
        if (shot.narration_clip) {
          fullNarration += `${shot.narration_clip} `;
        }
        assembledCodeParts.push(`        # Shot ${shot.shot_number || '?'} start=${shot.start_time_sec ?? '?'}s`);
        const normalizedAction = normalizeBlock(shot.manim_action || '');
        if (normalizedAction.trim()) {
          hasRenderableCode = true;
          assembledCodeParts.push(normalizedAction);
        }
      });
      return;
    }

    if (Array.isArray(scene.narration_segments)) {
      const normalizedBlock = normalizeBlock(scene.manim_code_block || '');
      if (normalizedBlock.trim()) {
        hasRenderableCode = true;
        assembledCodeParts.push(normalizedBlock);
      }
      fullNarration += `${scene.narration_segments.join(' ')} `;
      return;
    }

    if (scene.narration_script) {
      const normalizedBlock = normalizeBlock(scene.manim_code_block || '');
      if (normalizedBlock.trim()) {
        hasRenderableCode = true;
        assembledCodeParts.push(normalizedBlock);
      }
      fullNarration += `${scene.narration_script} `;
    }
  });

  fullNarration = stripPauseMarkers(fullNarration);
  if (!hasRenderableCode) {
    const fallback = createGroundedFallbackLecture(input, 'Lecture scenes contained no renderable Manim code.');
    return {
      ...fallback,
      title: parsedContent.title || fallback.title,
      narration: fullNarration || fallback.narration,
      totalDuration: parsedContent.total_estimated_duration_sec || fallback.totalDuration,
      scenes: parsedContent.scenes || fallback.scenes
    };
  }

  assembledCodeParts.push(footer);
  let fullManimCode = `${assembledCodeParts.join('\n')}\n`;
  const lines = fullManimCode.split('\n');
  let inConstruct = false;

  for (let index = 0; index < lines.length; index += 1) {
    if (/def construct\s*\(self\)/.test(lines[index])) {
      inConstruct = true;
      continue;
    }
    if (!inConstruct) continue;
    if (lines[index].trim() === '') continue;
    if (/^class\s/.test(lines[index])) {
      inConstruct = false;
      continue;
    }

    const indentLen = lines[index].match(/^(\s*)/)?.[0]?.length || 0;
    if (indentLen === 0 && !/^class\s|^def\s/.test(lines[index])) {
      lines[index] = `${' '.repeat(8)}${lines[index]}`;
    }
  }

  fullManimCode = lines.join('\n');
  if (isVisuallySparseManimCode(fullManimCode, parsedContent.scenes.length)) {
    return {
      narration: fullNarration || createGroundedFallbackLecture(input).narration,
      manimCode: buildDeterministicSceneScaffold(parsedContent, input),
      title: parsedContent.title || resolveLectureTitle(input),
      totalDuration: parsedContent.total_estimated_duration_sec || 90,
      scenes: parsedContent.scenes,
      warnings: ['Model-generated animation was visually sparse; applied deterministic scene scaffold.']
    };
  }

  return {
    narration: fullNarration || createGroundedFallbackLecture(input).narration,
    manimCode: fullManimCode,
    title: parsedContent.title || resolveLectureTitle(input),
    totalDuration: parsedContent.total_estimated_duration_sec || 90,
    scenes: parsedContent.scenes,
    warnings: []
  };
}

// Function to call LLM API
async function generateContent(input, deps = {}) {
  const generationMode = deps.generationMode || resolveLectureGenerationMode(input);
  const lecturePrompt = buildLectureUserPrompt(input, { generationMode });
  try {
    const parsedContent = await requestLectureCompletion(lecturePrompt, deps, { generationMode });
    return buildLectureFromParsedContent(parsedContent, input);
  } catch (error) {
    console.error('Error calling lecture model:', error.message);
    return createGroundedFallbackLecture(input, `${generationMode} mode failed: ${error.message || 'Unknown lecture generation error.'}`);
  }

  try {
    // ===== COMMENTED OUT OPENROUTER IMPLEMENTATION =====
    // // Using OpenRouter API (free tier)
    // const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
    //   model: 'openai/gpt-oss-120b:free',
    //   messages: [
    //     {
    //       role: 'system',
    //       content: `You are ManimGPT, an expert-level educational content director, creative visual storyteller, and senior Manim developer. Your sole purpose is to produce broadcast-quality, perfectly synchronized educational video lectures. You think step-by-step, meticulously planning the narration, visual metaphors, and animation timing for maximum educational impact.

    // Your output MUST be a single, valid JSON object, and nothing else.

    // ### CORE TASK

    // Given a topic, generate a structured plan for an educational video that is approximately over 90 seconds long. The plan will be a sequence of "scenes". Each scene contains a snippet of narration, with explicit pause markers, and the corresponding Manim code, precisely timed to match that narration.

    // ### THE LOGICAL FLOW (Your Internal Thought Process)

    // 1.  **Deconstruct Topic:** Break down the user's topic into 5-10 logical, sequential concepts. These will be the scenes.
    // 2.  **Storyboard Each Scene:** For each scene, you will:
    //     a.  **Design a Visual Metaphor:** Before writing code, decide on a clear visual way to represent the concept (e.g., "show data as blocks moving into a funnel for 'data processing'").
    //     b.  **Write Paced Narration:** Write a clear narration script. **Crucially, insert explicit pause markers \`[PAUSE=X]\` where a natural pause in speech would occur** (e.g., after a key phrase, at a comma, or before a new idea). \`X\` is the pause duration in seconds (e.g., \`[PAUSE=0.8]\`).
    //     c.  **Calculate Narration Time:** Estimate the speaking duration using a rate of **2.7 words per second (approx. 160 WPM)**, which is typical for web TTS. Add the durations from all \`[PAUSE=X]\` markers to this estimate. This is the \`estimated_narration_duration_sec\`.
    //     d.  **Write Purposeful Manim Code:** Write Manim code that executes the visual metaphor. The animations should directly illustrate the words being spoken.
    //     e.  **Calculate Animation Time:** Sum all \`run_time\` and \`self.wait()\` durations in the Manim code to get \`manim_animation_duration_sec\`.
    //     f.  **SYNCHRONIZE PERFECTLY:** This is your top priority. The \`self.wait(X)\` calls in your Manim code **MUST CORRESPOND DIRECTLY** to the \`[PAUSE=X]\` markers in your narration. The total \`manim_animation_duration_sec\` must be almost identical to \`estimated_narration_duration_sec\`. Adjust timings meticulously.
    // 3.  **Manage the Canvas:** Always end a scene's code by cleaning up the elements it created using \`self.play(FadeOut(object1, object2), ...)\` to prepare a clean slate for the next scene.
    // 4.  **Assemble JSON:** Combine all components into the final JSON structure defined below.

    // ### CRITICAL RULES & BEST PRACTICES
    // 0. **TTS**: ** Currently I'm using default browser tts, if that helps you estimate how long the narration will take.**
    // 1.  **JSON ONLY:** Your entire response must be a single, valid JSON object. No markdown, no commentary outside the JSON.
    // 2.  **STATE MANAGEMENT:** You are responsible for cleaning the canvas between scenes. No visual elements should overlap or persist unintentionally.
    // 3.  **CODE ELEGANCE & ROBUSTNESS:**
    //     *   **Permitted Objects:** \`Text\`, \`Circle\`, \`Square\`, \`Rectangle\`, \`Arrow\`, \`Line\`, \`VGroup\`, \`Dot\`, \`Brace\`.
    //     *   **ABSOLUTELY NO \`MathTex\` or \`Tex\`**. Use \`Text\` for all labels.
    //     *   **Animate with Purpose:** Don't just make things appear. Use animation to *explain*.
    //         *   **Flow & Process:** Use \`object.animate.shift()\` or \`Arrow\` to show movement and direction.
    //         *   **Focus & Emphasis:** Use \`Indicate\`, \`Circumscribe\`, or color changes (\`object.animate.set_color(ACCENT_COLOR)\`) to draw attention to what the narration is highlighting.
    //         *   **State Change:** Use \`Transform\` to show an object changing into something else (e.g., reactants turning into products).
    //     *   **Permitted Animations:** \`Create\`, \`Write\`, \`.animate\`, \`FadeIn\`, \`FadeOut\`, \`Transform\`, \`Indicate\`, \`Circumscribe\`.
    // 4.  **COMMENT YOUR CODE:** Add brief comments in the \`manim_code_block\` to explain your visual choices.

    // ### OUTPUT JSON STRUCTURE

    // {
    //   "title": "A concise, descriptive title for the video lecture.",
    //   "total_estimated_duration_sec": 120,
    //   "manim_header": "from manim import *\\\\n\\\\n# Set a consistent color scheme\\\\nTEXT_COLOR = WHITE\\\\nPRIMARY_COLOR = BLUE\\\\nSECONDARY_COLOR = GREEN\\\\nACCENT_COLOR = YELLOW\\\\n\\\\nclass LectureScene(Scene):\\\\n    def construct(self):\\\\n",
    //   "scenes": [
    //     {
    //       "scene_number": 1,
    //       "narration_script": "Welcome to our explanation of the greenhouse effect. [PAUSE=1.0] In short, it's the process that warms the Earth's surface.",
    //       "estimated_narration_duration_sec": 9,
    //       "manim_code_block": "        # Scene 1: Title and Definition\\\\n        title = Text('The Greenhouse Effect', font_size=48, color=PRIMARY_COLOR).to_edge(UP)\\\\n        subtitle = Text('The process that warms the Earth', font_size=28).next_to(title, DOWN)\\\\n        self.play(Write(title), run_time=2)\\\\n        self.wait(1.0) # Corresponds to [PAUSE=1.0]\\\\n        self.play(Write(subtitle), run_time=2)\\\\n        self.wait(4) # Padding to finish narration\\\\n",
    //       "manim_animation_duration_sec": 9
    //     },
    //     {
    //       "scene_number": 2,
    //       "narration_script": "First, energy from the sun travels to the Earth. [PAUSE=1.5] This is mostly visible light.",
    //       "estimated_narration_duration_sec": 8,
    //       "manim_code_block": "        # Scene 2: Solar Radiation\\\\n        self.play(FadeOut(title, subtitle))\\\\n        earth = Circle(radius=1.5, color=PRIMARY_COLOR, fill_opacity=1).shift(DOWN*0.5)\\\\n        earth_label = Text('Earth').move_to(earth.get_center())\\\\n        earth_group = VGroup(earth, earth_label)\\\\n        self.play(Create(earth_group))\\\\n        sun_rays = VGroup(*[Arrow(start=UP*4+RIGHT*x, end=earth.get_top()+RIGHT*x, color=ACCENT_COLOR, buff=0) for x in [-1.5, 0, 1.5]])\\\\n        self.play(FadeIn(sun_rays, shift=DOWN*2), run_time=2)\\\\n        self.wait(1.5) # Corresponds to [PAUSE=1.5]\\\\n        self.play(Indicate(sun_rays, color=ACCENT_COLOR))\\\\n        self.wait(2.5) # Padding\\\\n",
    //       "manim_animation_duration_sec": 8
    //     },
    //     {
    //       "scene_number": 3,
    //       "narration_script": "Some of this energy is reflected back into space, but much of it is absorbed, warming the planet. [PAUSE=1.0] Then, the Earth radiates heat outwards.",
    //       "estimated_narration_duration_sec": 11,
    //       "manim_code_block": "        # Scene 3: Absorption and Re-radiation\\\\n        reflected_ray = Arrow(start=earth.get_top(), end=UP*4, color=ACCENT_COLOR, buff=0).shift(LEFT*2)\\\\n        self.play(Transform(sun_rays[0], reflected_ray), FadeOut(sun_rays[1:]), run_time=2)\\\\n        self.play(earth.animate.set_color(ORANGE), run_time=1.5) # Show warming\\\\n        self.wait(1.0) # Corresponds to [PAUSE=1.0]\\\\n        heat_rays = VGroup(*[Arrow(start=earth.get_top(), end=earth.get_top() + UP*2, color=RED, buff=0).rotate(angle, about_point=earth.get_center()) for angle in [-0.5, 0, 0.5]])\\\\n        self.play(Create(heat_rays), run_time=2)\\\\n        self.wait(4.5) # Padding\\\\n",
    //       "manim_animation_duration_sec": 11
    //     }
    //   ],
    // ===== END COMMENTED OPENROUTER IMPLEMENTATION =====

    // Using Groq API (free tier with fast inference)
    const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
      model: 'openai/gpt-oss-120b',
      messages: [
        {
          role: 'system',
          content: `You are "Maestro," an AI system embodying the combined expertise of a master educational animator, a senior Manim software architect, and a physicist. Your purpose is to direct a flawless, broadcast-quality animated lecture with sub-second precision. You think like a cinematographer, planning every shot on a continuous timeline. You respect the laws of physics and spatial reality on your 2D canvas.
Your entire output MUST be a single, valid JSON object. Do not include any commentary, apologies, explanations, or markdown formatting outside of the JSON structure.
Your mission is to transform the user's topic at the end of this prompt into a perfectly structured animated lecture.
GROUNDING RULE: Base every explanation on the provided LectureContext source material. Do not invent unsupported facts.
CARDINAL RULES (Non-Negotiable)
JSON OUTPUT ONLY: Your entire response will be a single JSON object. It must be perfectly parsable.
CODE VALIDITY IS PARAMOUNT: The Python code inside the manim_action strings MUST be flawless.
Indentation: Python is indent-sensitive. Ensure all lines within the manim_action string are correctly indented relative to the construct(self): method.
String Escaping: Be meticulous. A " inside a string must be escaped as \". A newline must be \\n. A literal backslash must be \\\\. Incorrect escaping will invalidate the JSON or the Python code.
Variable Scope: Any object created in one shot that needs to be referenced in a later shot (e.g., block) MUST be assigned to self (e.g., self.block = ...) or added to the scene-wide VGroup to ensure it exists in the proper scope. For simplicity, add all created Mobjects to the all_scene_elements VGroup.
ROBUST CAMERA REFERENCE: To avoid AttributeError: 'Camera' object has no attributes 'frame','animate, you MUST use the following robust reference for any camera animations:
camera_frame = getattr(self.camera, 'frame', self.camera)
THE DIRECTOR'S MANDATES
You will internalize and obey these laws without exception.
MANDATE #1: THE LAW OF PHYSICAL REALITY
Drawing Order is Depth: Objects rendered first are in the background. To place a box on a table, you MUST create the table Mobject before you create the box Mobject.
Spatial Integrity: Objects do not pass through each other. Animate objects logically around each other unless the concept specifically requires it (e.g., transparency, quantum tunneling).
MANDATE #2: THE LAW OF INTENT & SYNCHRONICITY
Code IS Narration: Your animation must be a perfect visual representation of the narration. If the narration says "the circle turns red," the code MUST execute .animate.set_color(RED). There can be no contradictions.
The Golden Rule of Synchronization: The animation duration must accommodate the narration.
animation_duration = Sum of all run_time and wait values in a shot's manim_action.
narration_duration_est = (Word count of narration_clip) / 2.5.
You MUST ensure animation_duration >= narration_duration_est. If the animation is too short, you WILL add or increase a self.wait() call to add padding.
MANDATE #3: THE LAW OF CINEMATIC CRAFT
Establish, Then Explain: Begin complex scenes with a wider shot to establish all elements. Then, use camera pans, zooms (camera_frame.animate.scale(0.5).move_to(...)), and highlighters (Indicate, Circumscribe) to focus the viewer's attention as you explain specific parts.
Show, Don't Just Tell: Use Transform to show a change of state (e.g., Transform(water_object, ice_object)). Do not simply FadeOut the old and FadeIn the new.
Purposeful Motion: All animations must serve a pedagogical purpose. Use LaggedStart for group animations to feel organic and professional. Avoid meaningless movement.
PRODUCTION ALGORITHM
You will follow this process algorithmically for each scene.
Initialize Time: Set current_scene_time = 0.0.
Create Shot #1:
start_time_sec is current_scene_time.
Write the narration_clip.
Write the manim_action code string.
Calculate animation_duration by summing all run_time and wait values.
Verify against the Golden Rule of Synchronization. Add self.wait() padding if necessary.
Add all created Mobjects to the all_scene_elements VGroup.
Update Time: current_scene_time = current_scene_time + animation_duration.
Create Subsequent Shots: Repeat steps 2 and 3 for every shot, ensuring the timeline is continuous and sequential.
Assemble Final JSON: Combine all scenes and shots into the final, valid JSON object.
OUTPUT JSON SCHEMA
code
JSON
{
  "title": "A concise, descriptive title for the video lecture.",
  "total_estimated_duration_sec": 21.7,
  "manim_header": "from manim import *\\n\\n# Consistent Color Scheme\\nTEXT_COLOR = WHITE\\nPRIMARY_COLOR = BLUE_C\\nSECONDARY_COLOR = TEAL_C\\nACCENT_COLOR = GOLD_C\\nGOOD_COLOR = GREEN_C\\nBAD_COLOR = RED_C\\n\\nclass GeneratedScene(Scene):\\n    def construct(self):\\n        # Robust camera frame (avoids AttributeError across Manim variants)\\n        camera_frame = getattr(self.camera, 'frame', self.camera)\\n        # Master VGroup for managing all scene objects for accessibility and cleanup\\n        all_scene_elements = VGroup()\\n",
  "scenes": [
    {
      "scene_number": 1,
      "scene_summary": "Demonstrate Newton's First Law (Inertia) by showing a block at rest on a table and then being pushed.",
      "total_scene_duration_sec": 21.7,
      "shots": [
        {
          "shot_number": 1,
          "start_time_sec": 0.0,
          "narration_clip": "Let's explore Newton's First Law of Motion, the law of inertia.",
          "manim_action": "        # ESTABLISHING SHOT: Introduce the concept\\n        title = Text(\\\"Newton's First Law: Inertia\\\", font_size=40, color=PRIMARY_COLOR).to_edge(UP)\\n        self.play(Write(title), run_time=3.0)\\n        # DURATION: 3.0s (Write) + 2.4s (Wait) = 5.4s\\n        # NARRATION: 11 words / 2.5 wps = 4.4s. Rule Passed (5.4 > 4.4).\\n        self.wait(2.4)\\n        all_scene_elements.add(title)"
        },
        {
          "shot_number": 2,
          "start_time_sec": 5.4,
          "narration_clip": "It states that an object at rest will stay at rest.",
          "manim_action": "        # LAW OF PHYSICS: Draw table first, then block\\n        table = Rectangle(width=8, height=0.5, color=SECONDARY_COLOR, fill_opacity=1).shift(DOWN*2)\\n        block = Square(side_length=1.5, color=ACCENT_COLOR, fill_opacity=1).next_to(table, UP, buff=0)\\n        self.play(Create(table), run_time=1.5)\\n        self.play(FadeIn(block, shift=UP*0.5), run_time=1.5)\\n        # DURATION: 1.5s + 1.5s + 1.5s = 4.5s\\n        # NARRATION: 11 words / 2.5 wps = 4.4s. Rule Passed (4.5 > 4.4).\\n        self.wait(1.5)\\n        all_scene_elements.add(table, block)"
        },
        {
          "shot_number": 3,
          "start_time_sec": 9.9,
          "narration_clip": "Unless it is acted upon by an external force.",
          "manim_action": "        # LAW OF INTENT: Arrow shows the force, then block moves\\n        force_arrow = Arrow(start=LEFT*4, end=block.get_left(), color=BAD_COLOR, stroke_width=8)\\n        force_label = Text('Force').next_to(force_arrow, LEFT)\\n        self.play(Create(force_arrow), Write(force_label), run_time=2.0)\\n        self.wait(1.0)\\n        self.play(block.animate.shift(RIGHT*5), FadeOut(force_arrow, shift=RIGHT*5), FadeOut(force_label, shift=RIGHT*5), run_time=3.0)\\n        # DURATION: 2.0s + 1.0s + 3.0s = 6.0s\\n        # NARRATION: 9 words / 2.5 wps = 3.6s. Rule Passed (6.0 > 3.6).\\n        self.wait(0.0) # No extra padding needed.\\n        all_scene_elements.add(force_arrow, force_label)"
        },
        {
          "shot_number": 4,
          "start_time_sec": 15.9,
          "narration_clip": "The block is now an object in motion, and will stay in motion.",
          "manim_action": "        # LAW OF CINEMATOGRAPHY: Follow the object\\n        self.play(camera_frame.animate.move_to(block.get_center()), run_time=2.0)\\n        self.play(Circumscribe(block, color=GOOD_COLOR, time_width=2), run_time=2.0)\\n        # DURATION: 2.0s + 2.0s + 1.2s = 5.2s\\n        # NARRATION: 13 words / 2.5 wps = 5.2s. Rule Passed (5.2 >= 5.2).\\n        self.wait(1.2)\\n"
        }
      ]
    }
  ],
  "manim_footer": "\\n        # Final scene cleanup and linger\\n        self.play(FadeOut(all_scene_elements), run_time=1.0)\\n        self.wait(2.0)\\n"
}`
        },
        { role: 'user', content: lecturePrompt }
      ]
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    const content = response.data.choices[0].message.content;
    // Parse JSON response with better error handling
    let parsedContent;
    try {
      // First try direct JSON parse
      parsedContent = JSON.parse(content);
    } catch (parseError) {
  // Attempt to recover JSON from fenced code or braces
      
      try {
        // Extract JSON from markdown code blocks
        const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          let jsonString = jsonMatch[1] || jsonMatch[0];
          
          // Clean up common JSON issues
          jsonString = jsonString
            .replace(/\\n/g, '\\n')  // Fix newline escapes
            .replace(/\\\\/g, '\\')   // Fix double backslashes
            .replace(/‑/g, '-')       // Replace en-dash with hyphen
            .replace(/"/g, '"')       // Replace smart quotes
            .replace(/"/g, '"')       // Replace smart quotes
            .trim();
          
          parsedContent = JSON.parse(jsonString);
        } else {
          throw new Error('Could not extract JSON from response');
        }
      } catch (secondError) {
        // Hard fallback: avoid producing blank 3-second videos when parsing fails.
        return {
          narration: 'Generated content about the requested topic. The system encountered a parsing issue and used a safe animation fallback.',
          manimCode: generateFallbackManimCode(),
          title: 'Generated Lecture',
          totalDuration: 90,
          scenes: []
        };
      }
    }
    
    // Process new Maestro shot-based schema OR fall back to older formats
    if (parsedContent.scenes && Array.isArray(parsedContent.scenes)) {
      const header = parsedContent.manim_header || 'from manim import *\n\nclass GeneratedScene(Scene):\n    def construct(self):\n';
      const footer = parsedContent.manim_footer || '\n        # Final scene cleanup\n        self.wait(3)\n';

      let fullNarration = '';
      let assembledCodeParts = [header];
      let hasRenderableCode = false;

      // Helper to normalize indentation of a Manim action/code block
      const normalizeBlock = (block) => {
        if (!block) return '';
        const rawLines = block.replace(/\r\n/g, '\n').split('\n');
        // Trim empty edges
        while (rawLines.length && rawLines[0].trim() === '') rawLines.shift();
        while (rawLines.length && rawLines[rawLines.length - 1].trim() === '') rawLines.pop();
        if (!rawLines.length) return '';
        // Convert tabs to 4 spaces to standardize
        const converted = rawLines.map(l => l.replace(/\t/g, '    '));
        // Find minimal leading spaces among non-empty lines
        let minIndent = Infinity;
        converted.forEach(l => {
          if (l.trim() === '') return;
          const m = l.match(/^(\s*)/)[0];
          minIndent = Math.min(minIndent, m.length);
        });
        if (!isFinite(minIndent)) minIndent = 0;
        const BASE = 8; // base indent inside construct
        return converted.map(l => {
          if (l.trim() === '') return '';
          const m = l.match(/^(\s*)/)[0];
          const current = m.length;
          const relative = Math.max(0, current - minIndent); // preserve deeper structure
          const newIndent = ' '.repeat(BASE + relative);
          return newIndent + l.trimStart();
        }).join('\n');
      };

      parsedContent.scenes.forEach(scene => {
  assembledCodeParts.push(`        # Scene ${scene.scene_number || '?'}: ${scene.scene_summary || ''}`);

        // Maestro schema: shots
        if (Array.isArray(scene.shots)) {
          scene.shots.forEach(shot => {
            fullNarration += (shot.narration_clip ? shot.narration_clip + ' ' : '');
            assembledCodeParts.push(`        # Shot ${shot.shot_number || '?'} start=${shot.start_time_sec}s`);
            if (shot.manim_action) {
              const normalized = normalizeBlock(shot.manim_action);
              if (normalized.trim().length > 0) {
                hasRenderableCode = true;
                assembledCodeParts.push(normalized);
              }
            }
          });
        } else if (Array.isArray(scene.narration_segments)) {
          // Legacy narration_segments format
            {
              const normalized = normalizeBlock(scene.manim_code_block || '');
              if (normalized.trim().length > 0) {
                hasRenderableCode = true;
                assembledCodeParts.push(normalized);
              }
            }
            fullNarration += scene.narration_segments.join(' ') + ' ';
        } else if (scene.narration_script) {
          const normalized = normalizeBlock(scene.manim_code_block || '');
          if (normalized.trim().length > 0) {
            hasRenderableCode = true;
            assembledCodeParts.push(normalized);
          }
          fullNarration += scene.narration_script + ' ';
        }
      });

      if (!hasRenderableCode) {
        return {
          narration: fullNarration || 'Generated content about the requested topic.',
          manimCode: generateFallbackManimCode(),
          title: parsedContent.title || 'Generated Lecture',
          totalDuration: parsedContent.total_estimated_duration_sec || 90,
          scenes: parsedContent.scenes || []
        };
      }

      fullNarration = fullNarration.replace(/\[PAUSE=\d+\.?\d*\]/g, ' ').replace(/\s+/g, ' ').trim();
      assembledCodeParts.push(footer);
      let fullManimCode = assembledCodeParts.join('\n') + '\n';

    // Final pass: ensure lines inside construct have at least base indent, preserve deeper relative indents
      const lines = fullManimCode.split('\n');
      let inConstruct = false;
      for (let i = 0; i < lines.length; i++) {
        if (/def construct\s*\(self\)/.test(lines[i])) {
          inConstruct = true;
          continue;
        }
        if (inConstruct) {
          if (lines[i].trim() === '') continue;
      if (/^class\s/.test(lines[i])) { inConstruct = false; continue; }
      // Only fix totally unindented (accidental) lines; keep relative indents from normalizeBlock
          const match = lines[i].match(/^(\s*)/);
          const indentLen = match ? match[0].length : 0;
      if (indentLen === 0 && !/^class\s|^def\s/.test(lines[i])) {
            lines[i] = ' '.repeat(8) + lines[i];
          }
        }
      }
      fullManimCode = lines.join('\n');

      return {
        narration: fullNarration,
        manimCode: fullManimCode,
        title: parsedContent.title || 'Generated Lecture',
        totalDuration: parsedContent.total_estimated_duration_sec || 90,
        scenes: parsedContent.scenes // Preserve full timeline (shots) structure
      };
    }
    // Fallback if scenes missing
    return {
      narration: 'Generated content about the requested topic. The system encountered a parsing issue but generated educational content.',
      manimCode: generateFallbackManimCode()
    };
    
    // Validate and clean the Manim code (keeping this for fallback cases)
    if (parsedContent.manimCode) {
      // Remove any trailing characters that might cause syntax errors
      parsedContent.manimCode = parsedContent.manimCode.trim();
      
      // Basic validation - ensure it has the required class structure
      if (!parsedContent.manimCode.includes('class') || !parsedContent.manimCode.includes('def construct')) {
  // Invalid structure fallback
        parsedContent.manimCode = generateFallbackManimCode();
      }
    }
    
    return parsedContent;

  } catch (error) {
  console.error('Error calling LLM:', error.response?.data || error.message);
    
    // Fallback response for testing
    return {
      narration: "Welcome to this educational lecture about Newton's First Law of Motion. This law states that an object at rest stays at rest, and an object in motion stays in motion, unless acted upon by an external force.",
      manimCode: generateFallbackManimCode(),
      title: "Newton's First Law",
      totalDuration: 90,
      scenes: [{
        scene_number: 1,
        narration_script: "Welcome to this educational lecture about Newton's First Law of Motion. This law states that an object at rest stays at rest, and an object in motion stays in motion, unless acted upon by an external force.",
        estimated_narration_duration_sec: 20
      }]
    };
  }
}

// Function to execute Manim code
async function executeManimCode(manimCode, options = {}) {
  const { fallbackInput = null, allowFallbackRender = true } = options;
  try {
    // Create temporary Python file
    const tempDir = path.join(__dirname, '..', 'temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir);
    }
    
    const timestamp = Date.now();
    const pythonFile = path.join(tempDir, `lecture_${timestamp}.py`);
    const outputDir = path.join(__dirname, '..', 'videos');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    // Validate and clean Manim code before writing
    let cleanedCode = String(manimCode || '').trim();
    
  // Fix literal \n characters that should be actual newlines
  cleanedCode = cleanedCode.replace(/\\n/g, '\n');
  // Unescape over-escaped quotes (e.g., Text(\"...") -> Text("...") in Python source)
  cleanedCode = cleanedCode.replace(/\\\"/g, '"');
    
    // Check for basic Python syntax issues
    if (cleanedCode.includes('‑')) {
      cleanedCode = cleanedCode.replace(/‑/g, '-'); // Replace en-dash with hyphen
    }
    
    // Camera frame compatibility shim across Manim versions
    // Prefer self.camera_frame (older), then self.camera.frame (newer); else None
    cleanedCode = cleanedCode.replace(
      /camera_frame\s*=\s*getattr\(self\.camera,\s*['\"]frame['\"],\s*self\.camera\)/g,
      "camera_frame = getattr(self, 'camera_frame', getattr(self.camera, 'frame', None))"
    );
    // If no definition present, inject one right after construct(self):
    if (!/camera_frame\s*=\s*getattr\(self/.test(cleanedCode)) {
      cleanedCode = cleanedCode.replace(
        /(def\s+construct\s*\(self\)\s*:\s*\n)/,
        `$1        # Camera compatibility (older/newer Manim)\n        camera_frame = getattr(self, 'camera_frame', getattr(self.camera, 'frame', None))\n`
      );
    }
    // For environments without camera animation support, convert camera_frame animations to waits
    // Case 1: self.play(camera_frame.animate...., run_time=X)
    cleanedCode = cleanedCode.replace(
      /self\.play\(\s*camera_frame\.animate[\s\S]*?run_time\s*=\s*([0-9]+(?:\.[0-9]+)?)\s*\)/g,
      'self.wait($1)'
    );
    // Case 2: self.play(camera_frame.animate....) with no explicit run_time -> wait(1.0)
    cleanedCode = cleanedCode.replace(
      /self\.play\(\s*camera_frame\.animate[\s\S]*?\)/g,
      'self.wait(1.0)'
    );

    // Remove any trailing brackets or braces that might be artifacts
    cleanedCode = cleanedCode.replace(/[}\]]+\s*$/, '');
    
  // (debug logs removed)
    
    // Write Manim code to file
    fs.writeFileSync(pythonFile, cleanedCode);
    
    // Execute Manim with a consistent generation timeout ceiling
    const command = `manim "${pythonFile}" GeneratedScene -ql`;  // -ql = low quality
  // Execute
    
    try {
      const output = execSync(command, { 
        cwd: tempDir, 
        timeout: FIVE_MINUTES_MS,
        stdio: 'pipe',   // Capture output
        encoding: 'utf8'
      });
  // (suppress detailed output in normal operation)
    } catch (execError) {
      console.error('Manim execution error:', execError.message);
      throw execError;
    }
    
    // Find generated video file in the media folder structure
    const mediaFolder = path.join(tempDir, 'media');
    let videoPath = null;
    
  // Locate resulting mp4
    
    if (fs.existsSync(mediaFolder)) {
      // Manim creates a complex folder structure, let's find the MP4
      const findVideoRecursively = (dir) => {
        const files = fs.readdirSync(dir);
        for (const file of files) {
          const fullPath = path.join(dir, file);
          if (fs.statSync(fullPath).isDirectory()) {
            const found = findVideoRecursively(fullPath);
            if (found) return found;
          } else if (file.endsWith('.mp4')) {
            return fullPath;
          }
        }
        return null;
      };
      
      videoPath = findVideoRecursively(mediaFolder);
    } else {
  // Media folder missing
    }
    
    // If found, copy to our videos directory
    if (videoPath && fs.existsSync(videoPath)) {
      const finalPath = path.join(outputDir, `lecture_${timestamp}.mp4`);
      fs.copyFileSync(videoPath, finalPath);
      
      // Clean up temp files
      if (fs.existsSync(pythonFile)) fs.unlinkSync(pythonFile);
      if (fs.existsSync(mediaFolder)) {
        fs.rmSync(mediaFolder, { recursive: true, force: true });
      }
      
      return finalPath;
    } else {
      throw new Error('Video file not found after Manim execution');
    }

  } catch (error) {
    console.error('Error executing Manim:', error.message);

    if (allowFallbackRender) {
      try {
        const fallbackLecture = createGroundedFallbackLecture(
          fallbackInput || {},
          `Primary render failed: ${error.message}`
        );
        return await executeManimCode(fallbackLecture.manimCode, {
          fallbackInput,
          allowFallbackRender: false
        });
      } catch (fallbackError) {
        console.error('Fallback Manim render failed:', fallbackError.message);
        throw new Error(`Primary render failed: ${error.message}. Fallback render failed: ${fallbackError.message}`);
      }
    }

    throw error;
  }
}

router.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'Each uploaded file must be 20 MB or smaller.' });
    }
    if (error.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ error: 'Upload either 1 PDF or up to 5 images.' });
    }
    return res.status(400).json({ error: error.message });
  }
  return next(error);
});

router.__private = {
  resolveLectureGenerationMode,
  buildLectureUserPrompt,
  buildLectureSystemPrompt,
  buildLectureResponseSchema,
  extractBalancedJsonBlock,
  parseLectureJson,
  generateFallbackManimCode,
  createGroundedFallbackLecture,
  buildLectureFromParsedContent,
  generateContent,
  executeManimCode
};

module.exports = router;
