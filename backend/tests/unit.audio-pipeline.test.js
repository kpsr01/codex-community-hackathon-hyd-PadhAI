const assert = require('node:assert/strict');

const { __private: audioPrivate } = require('../services/audio/lectureAudio');

async function run() {
  const cleaned = audioPrivate.cleanNarrationText('Hello [PAUSE=1.2] world\n\n**test**');
  assert.equal(cleaned, 'Hello world test');

  const longSentence = Array.from({ length: 520 }, () => 'motion').join(' ');
  const chunks = audioPrivate.splitTextForTts(`${longSentence}. Another sentence.`);
  assert.ok(chunks.length >= 2);
  assert.ok(chunks.every((chunk) => chunk.length > 0));

  const segments = audioPrivate.flattenLectureSegments({
    scenes: [
      {
        scene_number: 1,
        _scene_offset_sec: 2,
        shots: [
          { shot_number: 1, start_time_sec: 0, narration_clip: 'First shot' },
          { shot_number: 2, start_time_sec: 4.5, narration_clip: 'Second shot' }
        ]
      },
      {
        scene_number: 2,
        narration_script: 'Scene fallback narration'
      }
    ]
  });

  assert.equal(segments.length, 3);
  assert.equal(segments[0].sourceType, 'shot');
  assert.equal(segments[0].startSec, 2);
  assert.equal(segments[1].startSec, 6.5);
  assert.equal(segments[2].sourceType, 'scene');
  assert.equal(segments[2].startSec, 7.5);

  const autoOffsetSegments = audioPrivate.flattenLectureSegments({
    scenes: [
      {
        scene_number: 1,
        narration_script: 'First scene narration',
        manim_animation_duration_sec: 8
      },
      {
        scene_number: 2,
        narration_script: 'Second scene narration',
        manim_animation_duration_sec: 6
      }
    ]
  });

  assert.equal(autoOffsetSegments.length, 2);
  assert.equal(autoOffsetSegments[0].startSec, 0);
  assert.equal(autoOffsetSegments[1].startSec, 8);
}

module.exports = { run };
