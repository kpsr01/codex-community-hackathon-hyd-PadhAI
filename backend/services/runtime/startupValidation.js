const { spawnSync } = require('child_process');

const { getOpenAIConfig } = require('../openai/apiClient');

function resolveBinary(envVar, fallback) {
  return process.env[envVar] || fallback;
}

function ensureBinary(binaryPath, args = ['-version']) {
  const result = spawnSync(binaryPath, args, {
    encoding: 'utf8',
    timeout: 15000
  });

  if (result.error || result.status !== 0) {
    throw new Error(result.error?.message || result.stderr || `${binaryPath} is unavailable.`);
  }
}

function validateStartupRequirements() {
  const config = getOpenAIConfig();
  const missing = [];

  if (!config.apiKey) missing.push('OPENAI_API_KEY');
  if (!config.coreModel) missing.push('OPENAI_CORE_MODEL');
  if (!config.ttsModel) missing.push('OPENAI_TTS_MODEL');
  if (!config.ttsVoice) missing.push('OPENAI_TTS_VOICE');

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  ensureBinary(resolveBinary('FFMPEG_PATH', 'ffmpeg'));
  ensureBinary(resolveBinary('FFPROBE_PATH', 'ffprobe'));
}

module.exports = {
  validateStartupRequirements,
  __private: {
    resolveBinary,
    ensureBinary
  }
};
