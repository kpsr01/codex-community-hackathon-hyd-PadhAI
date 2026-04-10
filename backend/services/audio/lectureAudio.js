const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const { THIRTY_MINUTES_MS } = require('../../config/timeouts');
const { synthesizeSpeech } = require('../openai/apiClient');

const AUDIO_SAMPLE_RATE = 24000;
const MAX_TTS_CHARS = 3200;
const MAX_TTS_WORDS = 450;
const DEFAULT_SPEECH_WORDS_PER_SEC = 2.5;
const MIN_SEGMENT_DURATION_SEC = 1;
const OVERLAP_TOLERANCE_SEC = 0.05;

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function cleanNarrationText(text) {
  return String(text || '')
    .replace(/\*\*/g, '')
    .replace(/\*/g, '')
    .replace(/\[PAUSE=\d+\.?\d*\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitLongSentence(sentence) {
  const parts = [];
  const words = sentence.split(/\s+/).filter(Boolean);
  let current = [];

  words.forEach((word) => {
    current.push(word);
    const joined = current.join(' ');
    if (joined.length >= MAX_TTS_CHARS || current.length >= MAX_TTS_WORDS) {
      parts.push(joined.trim());
      current = [];
    }
  });

  if (current.length > 0) {
    parts.push(current.join(' ').trim());
  }

  return parts.filter(Boolean);
}

function splitTextForTts(text) {
  const cleaned = cleanNarrationText(text);
  if (!cleaned) return [];

  if (cleaned.length <= MAX_TTS_CHARS && cleaned.split(/\s+/).length <= MAX_TTS_WORDS) {
    return [cleaned];
  }

  const sentences = cleaned.match(/[^.!?]+[.!?]?/g) || [cleaned];
  const chunks = [];
  let current = '';

  sentences.forEach((sentence) => {
    const normalized = sentence.trim();
    if (!normalized) return;

    if (normalized.length > MAX_TTS_CHARS || normalized.split(/\s+/).length > MAX_TTS_WORDS) {
      if (current) {
        chunks.push(current.trim());
        current = '';
      }
      chunks.push(...splitLongSentence(normalized));
      return;
    }

    const candidate = current ? `${current} ${normalized}` : normalized;
    if (candidate.length > MAX_TTS_CHARS || candidate.split(/\s+/).length > MAX_TTS_WORDS) {
      if (current) chunks.push(current.trim());
      current = normalized;
    } else {
      current = candidate;
    }
  });

  if (current) chunks.push(current.trim());
  return chunks.filter(Boolean);
}

function toNonNegativeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function estimateNarrationDurationSec(text) {
  const cleaned = cleanNarrationText(text);
  if (!cleaned) return 0;
  const words = cleaned.split(/\s+/).filter(Boolean).length;
  return words > 0 ? words / DEFAULT_SPEECH_WORDS_PER_SEC : 0;
}

function estimateShotDurationSec(shot) {
  const candidates = [
    shot?.manim_animation_duration_sec,
    shot?.estimated_narration_duration_sec,
    shot?.duration_sec
  ];

  for (const candidate of candidates) {
    const value = Number(candidate);
    if (Number.isFinite(value) && value > 0) {
      return value;
    }
  }

  const fromNarration = estimateNarrationDurationSec(shot?.narration_clip);
  return Math.max(MIN_SEGMENT_DURATION_SEC, fromNarration);
}

function estimateSceneDurationSec(scene) {
  const candidates = [
    scene?.total_scene_duration_sec,
    scene?.manim_animation_duration_sec,
    scene?.estimated_narration_duration_sec
  ];

  for (const candidate of candidates) {
    const value = Number(candidate);
    if (Number.isFinite(value) && value > 0) {
      return value;
    }
  }

  if (Array.isArray(scene?.shots) && scene.shots.length > 0) {
    let maxEndSec = 0;
    scene.shots.forEach((shot) => {
      const startSec = toNonNegativeNumber(shot?.start_time_sec, 0);
      const durationSec = estimateShotDurationSec(shot);
      maxEndSec = Math.max(maxEndSec, startSec + durationSec);
    });
    if (maxEndSec > 0) return maxEndSec;
  }

  const fromNarration = estimateNarrationDurationSec(scene?.narration_script);
  return Math.max(MIN_SEGMENT_DURATION_SEC, fromNarration);
}

function flattenLectureSegments(lecture) {
  const lectureScenes = Array.isArray(lecture?.scenes) ? lecture.scenes : [];
  const segments = [];
  let runningSceneOffsetSec = 0;

  lectureScenes.forEach((scene, sceneIndex) => {
    const sceneNumber = scene?.scene_number || sceneIndex + 1;
    const shots = Array.isArray(scene?.shots) ? scene.shots : [];
    const shotStartCandidates = shots.map((shot) => toNonNegativeNumber(shot?.start_time_sec, 0));
    const minShotStartSec = shotStartCandidates.length > 0
      ? Math.min(...shotStartCandidates)
      : 0;
    const hasExplicitSceneOffset = Number.isFinite(Number(scene?._scene_offset_sec))
      && Number(scene?._scene_offset_sec) >= 0;
    const treatShotStartsAsAbsolute = !hasExplicitSceneOffset
      && shotStartCandidates.length > 0
      && minShotStartSec + OVERLAP_TOLERANCE_SEC >= runningSceneOffsetSec;
    const sceneOffset = hasExplicitSceneOffset
      ? toNonNegativeNumber(scene?._scene_offset_sec, 0)
      : (treatShotStartsAsAbsolute ? 0 : runningSceneOffsetSec);
    const sceneDurationSec = Math.max(MIN_SEGMENT_DURATION_SEC, estimateSceneDurationSec(scene));

    if (shots.length > 0) {
      shots.forEach((shot, shotIndex) => {
        const narration = cleanNarrationText(shot?.narration_clip);
        if (!narration) return;
        segments.push({
          id: `scene_${sceneNumber}_shot_${shot?.shot_number || shotIndex + 1}`,
          sceneNumber,
          shotNumber: shot?.shot_number || shotIndex + 1,
          startSec: toNonNegativeNumber(shot?.start_time_sec, 0) + sceneOffset,
          text: narration,
          sourceType: 'shot'
        });
      });
      runningSceneOffsetSec = Math.max(runningSceneOffsetSec, sceneOffset + sceneDurationSec);
      return;
    }

    const narration = cleanNarrationText(scene?.narration_script);
    if (!narration) return;
    segments.push({
      id: `scene_${sceneNumber}`,
      sceneNumber,
      shotNumber: null,
      startSec: toNonNegativeNumber(sceneOffset, 0),
      text: narration,
      sourceType: 'scene'
    });

    runningSceneOffsetSec = Math.max(runningSceneOffsetSec, sceneOffset + sceneDurationSec);
  });

  if (segments.length === 0) {
    const fallbackNarration = cleanNarrationText(lecture?.narration);
    if (fallbackNarration) {
      segments.push({
        id: 'lecture_full',
        sceneNumber: 1,
        shotNumber: null,
        startSec: 0,
        text: fallbackNarration,
        sourceType: 'lecture'
      });
    }
  }

  return segments.sort((left, right) => left.startSec - right.startSec);
}

function buildTeacherInstructions() {
  return [
    'Speak like a clear, engaging teacher.',
    'Use a calm, confident classroom tone.',
    'Keep pacing steady and natural for educational narration.',
    'Pronounce technical terms carefully.',
    'Avoid exaggerated emotion or theatrical delivery.'
  ].join(' ');
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const timeoutMs = options.timeoutMs || THIRTY_MINUTES_MS;

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
    };

    const finishResolve = (value) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };

    const finishReject = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!settled) child.kill('SIGKILL');
      }, 1000);
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      finishReject(error);
    });
    child.on('close', (code) => {
      if (timedOut) {
        finishReject(new Error(`${command} timed out after ${Math.round(timeoutMs / 60000)} minutes.`));
        return;
      }
      if (code === 0) {
        finishResolve({ stdout, stderr });
        return;
      }
      finishReject(new Error(stderr.trim() || `${command} exited with code ${code}`));
    });
  });
}

function resolveBinary(envVar, fallbackName) {
  return process.env[envVar] || fallbackName;
}

async function probeDurationSeconds(filePath) {
  const ffprobe = resolveBinary('FFPROBE_PATH', 'ffprobe');
  const { stdout } = await runCommand(ffprobe, [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    filePath
  ]);

  const duration = Number.parseFloat(String(stdout || '').trim());
  if (!Number.isFinite(duration)) {
    throw new Error(`Could not determine audio duration for ${filePath}`);
  }
  return duration;
}

async function stitchSegmentsToTrack({ outputPath, segments }) {
  const ffmpeg = resolveBinary('FFMPEG_PATH', 'ffmpeg');
  const totalDuration = Math.max(
    1,
    ...segments.map((segment) => segment.startSec + segment.durationSec + 0.05)
  );

  const args = [
    '-y',
    '-f', 'lavfi',
    '-t', totalDuration.toFixed(3),
    '-i', `anullsrc=r=${AUDIO_SAMPLE_RATE}:cl=mono`
  ];

  segments.forEach((segment) => {
    args.push('-i', segment.filePath);
  });

  const filterParts = [];
  const mixInputs = ['[0:a]'];

  segments.forEach((segment, index) => {
    const delayMs = Math.max(0, Math.round(segment.startSec * 1000));
    const label = `s${index}`;
    filterParts.push(
      `[${index + 1}:a]aresample=${AUDIO_SAMPLE_RATE},aformat=sample_rates=${AUDIO_SAMPLE_RATE}:channel_layouts=mono,adelay=${delayMs}:all=true[${label}]`
    );
    mixInputs.push(`[${label}]`);
  });

  filterParts.push(
    `${mixInputs.join('')}amix=inputs=${mixInputs.length}:duration=longest:dropout_transition=0:normalize=0[aout]`
  );

  args.push(
    '-filter_complex', filterParts.join(';'),
    '-map', '[aout]',
    '-c:a', 'pcm_s16le',
    outputPath
  );

  await runCommand(ffmpeg, args);
  return totalDuration;
}

async function synthesizeLectureAudio(lecture, context = {}, options = {}) {
  const requestId = options.requestId || `req_${Date.now()}`;
  const audioDir = path.join(__dirname, '..', '..', 'audio');
  const tempDir = path.join(__dirname, '..', '..', 'temp', `audio_${requestId}`);

  ensureDir(audioDir);
  ensureDir(tempDir);

  const logicalSegments = flattenLectureSegments(lecture);
  if (logicalSegments.length === 0) {
    throw new Error('No narration segments were available for TTS synthesis.');
  }

  const warnings = [];
  const manifestSegments = [];
  let sequenceNumber = 0;
  let timelineCursorSec = 0;

  for (let index = 0; index < logicalSegments.length; index += 1) {
    const logicalSegment = logicalSegments[index];
    const chunks = splitTextForTts(logicalSegment.text);
    const targetStartSec = toNonNegativeNumber(logicalSegment.startSec, 0);
    let runningStartSec = Math.max(targetStartSec, timelineCursorSec);

    if (runningStartSec > targetStartSec + OVERLAP_TOLERANCE_SEC) {
      warnings.push(
        `Adjusted narration cue by ${(runningStartSec - targetStartSec).toFixed(2)}s near ${logicalSegment.id} to avoid overlap.`
      );
    }

    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
      const chunkText = chunks[chunkIndex];
      const buffer = await synthesizeSpeech({
        input: chunkText,
        instructions: buildTeacherInstructions(),
        responseFormat: 'wav'
      }, options.deps);

      const fileName = `lecture_${requestId}_${String(sequenceNumber + 1).padStart(3, '0')}.wav`;
      const filePath = path.join(tempDir, fileName);
      fs.writeFileSync(filePath, buffer);

      const durationSec = await probeDurationSeconds(filePath);
      manifestSegments.push({
        id: `${logicalSegment.id}_${chunkIndex + 1}`,
        sceneNumber: logicalSegment.sceneNumber,
        shotNumber: logicalSegment.shotNumber,
        sourceType: logicalSegment.sourceType,
        startSec: runningStartSec,
        durationSec,
        text: chunkText,
        filePath
      });

      runningStartSec += durationSec;
      sequenceNumber += 1;
    }

    timelineCursorSec = Math.max(timelineCursorSec, runningStartSec);

    const nextSegment = logicalSegments[index + 1];
    if (nextSegment && runningStartSec > nextSegment.startSec + OVERLAP_TOLERANCE_SEC) {
      warnings.push(
        `Narration duration exceeded planned cue window by ${(runningStartSec - nextSegment.startSec).toFixed(2)}s near ${logicalSegment.id}. Later cues were shifted to remain sequential.`
      );
    }
  }

  const stitchedBaseName = `lecture_${requestId}_narration.wav`;
  const manifestBaseName = `lecture_${requestId}_narration_manifest.json`;
  const stitchedPath = path.join(audioDir, stitchedBaseName);
  const manifestPath = path.join(audioDir, manifestBaseName);
  const totalDurationSec = await stitchSegmentsToTrack({
    outputPath: stitchedPath,
    segments: manifestSegments
  });

  fs.writeFileSync(manifestPath, JSON.stringify({
    requestId,
    topic: context?.topic || lecture?.title || 'Generated Lecture',
    totalDurationSec,
    segments: manifestSegments.map((segment) => ({
      id: segment.id,
      sceneNumber: segment.sceneNumber,
      shotNumber: segment.shotNumber,
      sourceType: segment.sourceType,
      startSec: segment.startSec,
      durationSec: segment.durationSec,
      text: segment.text
    }))
  }, null, 2));

  return {
    audioPath: stitchedPath,
    manifestPath,
    totalDurationSec,
    warnings,
    url: `/audio/${stitchedBaseName}`,
    manifestUrl: `/audio/${manifestBaseName}`,
    segments: manifestSegments.map((segment) => ({
      id: segment.id,
      sceneNumber: segment.sceneNumber,
      shotNumber: segment.shotNumber,
      sourceType: segment.sourceType,
      startSec: segment.startSec,
      durationSec: segment.durationSec,
      text: segment.text
    }))
  };
}

async function muxLectureVideo({ videoPath, audio, requestId }) {
  if (!audio?.audioPath) {
    throw new Error('Cannot mux lecture video without a synthesized audio track.');
  }

  const ffmpeg = resolveBinary('FFMPEG_PATH', 'ffmpeg');
  const audioDurationSec = await probeDurationSeconds(audio.audioPath);
  const videoDurationSec = await probeDurationSeconds(videoPath);
  const outputPath = path.join(
    path.dirname(videoPath),
    `${path.basename(videoPath, path.extname(videoPath))}_narrated.mp4`
  );
  const padDuration = Math.max(0, audioDurationSec - videoDurationSec);
  const needsPad = padDuration > 0.05;
  const padWarningThresholdSec = 1;

  const args = needsPad
    ? [
      '-y',
      '-i', videoPath,
      '-i', audio.audioPath,
      '-filter_complex', `[0:v]tpad=stop_mode=clone:stop_duration=${padDuration.toFixed(3)}[v]`,
      '-map', '[v]',
      '-map', '1:a:0',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-shortest',
      outputPath
    ]
    : [
      '-y',
      '-i', videoPath,
      '-i', audio.audioPath,
      '-map', '0:v:0',
      '-map', '1:a:0',
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-shortest',
      outputPath
    ];

  await runCommand(ffmpeg, args);

  return {
    requestId,
    videoPath: outputPath,
    warnings: padDuration >= padWarningThresholdSec
      ? [`Extended the final video by ${padDuration.toFixed(2)}s to fit narrated audio.`]
      : [],
    audio: {
      ...audio,
      muxedVideoUrl: `/videos/${path.basename(outputPath)}`,
      audioDurationSec,
      originalVideoDurationSec: videoDurationSec
    }
  };
}

module.exports = {
  synthesizeLectureAudio,
  muxLectureVideo,
  __private: {
    cleanNarrationText,
    splitTextForTts,
    splitLongSentence,
    toNonNegativeNumber,
    estimateNarrationDurationSec,
    estimateShotDurationSec,
    estimateSceneDurationSec,
    flattenLectureSegments,
    probeDurationSeconds,
    stitchSegmentsToTrack,
    resolveBinary
  }
};
