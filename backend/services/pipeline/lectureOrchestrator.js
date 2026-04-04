function nowMs() {
  return Number(process.hrtime.bigint() / BigInt(1e6));
}

function stageLogger(requestId, stage, payload) {
  console.log(JSON.stringify({
    type: 'pipeline_stage',
    requestId,
    stage,
    ...payload
  }));
}

function createLectureOrchestrator(deps) {
  if (!deps) throw new Error('Missing orchestrator dependencies');
  const {
    normalizeRequest,
    buildContext,
    enrichContext,
    generateLecture,
    renderVideo,
    synthesizeAudio,
    muxVideo,
    assembleArtifacts,
    generateQuiz,
    generateFlashcards
  } = deps;

  return {
    async run({ req, requestId }) {
      const stageTimingsMs = {};
      const startedAt = nowMs();
      const warnings = [];

      const stageStartNormalize = nowMs();
      const normalized = await normalizeRequest(req);
      stageTimingsMs.normalize_input = nowMs() - stageStartNormalize;
      if (normalized && normalized.timingsMs && typeof normalized.timingsMs.extract_sources === 'number') {
        stageTimingsMs.extract_sources = normalized.timingsMs.extract_sources;
      }
      warnings.push(...(normalized.warnings || []));
      stageLogger(requestId, 'normalize_input', { durationMs: stageTimingsMs.normalize_input });

      const stageStartContext = nowMs();
      let context = await buildContext(normalized);
      stageTimingsMs.build_context = nowMs() - stageStartContext;
      stageLogger(requestId, 'build_context', { durationMs: stageTimingsMs.build_context });

      if (enrichContext) {
        const stageStartEnrich = nowMs();
        const enriched = await enrichContext(context);
        stageTimingsMs.enrich_context = nowMs() - stageStartEnrich;
        stageLogger(requestId, 'enrich_context', { durationMs: stageTimingsMs.enrich_context });

        if (enriched && Array.isArray(enriched.warnings)) {
          warnings.push(...enriched.warnings);
        }

        if (enriched && enriched.context) {
          context = enriched.context;
        }
      }

      const stageStartLecture = nowMs();
      const lecture = await generateLecture(context);
      stageTimingsMs.generate_lecture = nowMs() - stageStartLecture;
      if (lecture && Array.isArray(lecture.warnings)) {
        warnings.push(...lecture.warnings);
      }
      stageLogger(requestId, 'generate_lecture', { durationMs: stageTimingsMs.generate_lecture });

      const stageStartRender = nowMs();
      const stageStartAudio = nowMs();
      const stageStartQuiz = nowMs();
      const stageStartFlashcards = nowMs();

      const renderPromise = renderVideo(lecture, context)
        .then((videoPath) => {
          stageTimingsMs.render_video = nowMs() - stageStartRender;
          stageLogger(requestId, 'render_video', { durationMs: stageTimingsMs.render_video });
          return videoPath;
        });

      const audioPromise = synthesizeAudio
        ? synthesizeAudio(lecture, context, { requestId }).then((audio) => {
          stageTimingsMs.synthesize_audio = nowMs() - stageStartAudio;
          stageLogger(requestId, 'synthesize_audio', { durationMs: stageTimingsMs.synthesize_audio });
          return audio;
        })
        : Promise.resolve(null);

      const quizPromise = normalized.generateQuiz && generateQuiz
        ? generateQuiz(context).then((quiz) => {
          stageTimingsMs.generate_quiz = nowMs() - stageStartQuiz;
          stageLogger(requestId, 'generate_quiz', { durationMs: stageTimingsMs.generate_quiz });
          return quiz;
        })
        : Promise.resolve([]);

      const flashcardPromise = normalized.generateFlashcards && generateFlashcards
        ? generateFlashcards(context).then((flashcards) => {
          stageTimingsMs.generate_flashcards = nowMs() - stageStartFlashcards;
          stageLogger(requestId, 'generate_flashcards', { durationMs: stageTimingsMs.generate_flashcards });
          return flashcards;
        })
        : Promise.resolve([]);

      const [renderResult, audioResult, quizResult, flashcardResult] = await Promise.allSettled([
        renderPromise,
        audioPromise,
        quizPromise,
        flashcardPromise
      ]);

      if (renderResult.status !== 'fulfilled') {
        throw renderResult.reason;
      }

      if (audioResult.status !== 'fulfilled') {
        throw audioResult.reason;
      }

      let videoPath = renderResult.value;
      let audio = audioResult.value;
      let quiz = [];
      let flashcards = [];

      if (quizResult.status === 'fulfilled') {
        quiz = Array.isArray(quizResult.value) ? quizResult.value : [];
      } else {
        warnings.push(`Quiz generation failed: ${quizResult.reason?.message || 'Unknown error'}`);
      }

      if (flashcardResult.status === 'fulfilled') {
        flashcards = Array.isArray(flashcardResult.value) ? flashcardResult.value : [];
      } else {
        warnings.push(`Flashcard generation failed: ${flashcardResult.reason?.message || 'Unknown error'}`);
      }

      if (audio && Array.isArray(audio.warnings)) {
        warnings.push(...audio.warnings);
      }

      if (audio && muxVideo) {
        const stageStartMux = nowMs();
        const muxResult = await muxVideo({
          videoPath,
          audio,
          lecture,
          context,
          requestId
        });
        stageTimingsMs.mux_video = nowMs() - stageStartMux;
        stageLogger(requestId, 'mux_video', { durationMs: stageTimingsMs.mux_video });

        if (muxResult && muxResult.videoPath) {
          videoPath = muxResult.videoPath;
        }
        if (muxResult && muxResult.audio) {
          audio = muxResult.audio;
        }
        if (muxResult && Array.isArray(muxResult.warnings)) {
          warnings.push(...muxResult.warnings);
        }
      }

      const stageStartAssemble = nowMs();
      const response = assembleArtifacts({
        requestId,
        inputMode: normalized.inputMode,
        warnings,
        stageTimingsMs,
        context,
        lecture,
        videoPath,
        audio,
        quiz,
        flashcards,
        sourceSummary: normalized.sourceSummary || {}
      });
      stageTimingsMs.assemble_response = nowMs() - stageStartAssemble;
      stageTimingsMs.total = nowMs() - startedAt;
      stageLogger(requestId, 'assemble_response', { durationMs: stageTimingsMs.assemble_response });
      stageLogger(requestId, 'pipeline_complete', { durationMs: stageTimingsMs.total });

      // Keep metadata timings complete in final payload.
      if (response.metadata) {
        response.metadata.stageTimingsMs = stageTimingsMs;
      }

      return response;
    }
  };
}

module.exports = {
  createLectureOrchestrator
};
