const axios = require('axios');

const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const DEFAULT_RETRY_STATUS = new Set([408, 409, 429, 500, 502, 503, 504]);

function parseBooleanEnv(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getOpenAIConfig() {
  return {
    apiKey: process.env.OPENAI_API_KEY || '',
    baseUrl: OPENAI_BASE_URL,
    coreModel: process.env.OPENAI_CORE_MODEL || 'gpt-5.4',
    ttsModel: process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts-2025-12-15',
    ttsVoice: process.env.OPENAI_TTS_VOICE || 'marin',
    storeResponses: parseBooleanEnv(process.env.OPENAI_STORE_RESPONSES, false)
  };
}

function buildHeaders(apiKey) {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json'
  };
}

function normalizeProviderError(error, provider = 'OpenAI') {
  const status = error?.response?.status;
  const apiMessage = error?.response?.data?.error?.message;
  const message = apiMessage || error?.message || `${provider} request failed.`;
  if (status) {
    return `${provider} request failed (${status}): ${message}`;
  }
  return `${provider} request failed: ${message}`;
}

function buildStructuredResponsePayload({
  instructions,
  input,
  schema,
  name,
  model,
  store,
  reasoningEffort,
  verbosity
}) {
  const payload = {
    model,
    store,
    input: Array.isArray(input)
      ? input
      : [
        { role: 'developer', content: instructions },
        { role: 'user', content: input }
      ],
    text: {
      format: {
        type: 'json_schema',
        name,
        strict: true,
        schema
      }
    }
  };

  if (!Array.isArray(input) && instructions) {
    payload.input[0].content = instructions;
  }

  if (reasoningEffort) {
    payload.reasoning = { effort: reasoningEffort };
  }

  if (verbosity) {
    payload.text.verbosity = verbosity;
  }

  return payload;
}

function buildSpeechPayload({ model, voice, input, instructions, responseFormat }) {
  const payload = {
    model,
    voice,
    input,
    response_format: responseFormat || 'wav'
  };

  if (instructions) {
    payload.instructions = instructions;
  }

  return payload;
}

function extractResponseText(data) {
  if (typeof data?.output_text === 'string' && data.output_text.trim()) {
    return data.output_text.trim();
  }

  const pieces = [];
  const outputItems = Array.isArray(data?.output) ? data.output : [];
  outputItems.forEach((item) => {
    const content = Array.isArray(item?.content) ? item.content : [];
    content.forEach((entry) => {
      if (typeof entry?.text === 'string' && entry.text.trim()) {
        pieces.push(entry.text.trim());
      } else if (typeof entry?.value === 'string' && entry.value.trim()) {
        pieces.push(entry.value.trim());
      }
    });
  });

  return pieces.join('\n').trim();
}

function extractParsedOutput(data) {
  if (data?.output_parsed && typeof data.output_parsed === 'object') {
    return data.output_parsed;
  }

  const responseText = extractResponseText(data);
  if (!responseText) {
    return null;
  }

  return JSON.parse(responseText);
}

async function postWithRetries(url, payload, options = {}, deps = {}) {
  const clientPost = deps.clientPost || axios.post;
  const maxAttempts = Number.isInteger(options.maxAttempts) ? options.maxAttempts : 3;
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await clientPost(url, payload, options.requestConfig || {});
    } catch (error) {
      lastError = error;
      const status = error?.response?.status;
      if (!DEFAULT_RETRY_STATUS.has(status) || attempt === maxAttempts) {
        break;
      }

      const retryAfter = Number.parseInt(error?.response?.headers?.['retry-after'], 10);
      const backoffMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : Math.min(1000 * (2 ** (attempt - 1)), 8000);
      await sleep(backoffMs);
    }
  }

  throw lastError;
}

async function createStructuredResponse(params, deps = {}) {
  const config = getOpenAIConfig();
  const apiKey = params.apiKey || config.apiKey;

  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured.');
  }

  const payload = buildStructuredResponsePayload({
    instructions: params.instructions,
    input: params.input,
    schema: params.schema,
    name: params.name || 'structured_response',
    model: params.model || config.coreModel,
    store: typeof params.store === 'boolean' ? params.store : config.storeResponses,
    reasoningEffort: params.reasoningEffort || 'low',
    verbosity: params.verbosity
  });

  try {
    const response = await postWithRetries(`${config.baseUrl}/responses`, payload, {
      requestConfig: {
        headers: buildHeaders(apiKey),
        timeout: params.timeoutMs || 60000
      },
      maxAttempts: params.maxAttempts || 3
    }, deps);

    return {
      data: response.data,
      parsed: extractParsedOutput(response.data),
      text: extractResponseText(response.data)
    };
  } catch (error) {
    throw new Error(normalizeProviderError(error));
  }
}

async function synthesizeSpeech(params, deps = {}) {
  const config = getOpenAIConfig();
  const apiKey = params.apiKey || config.apiKey;

  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured.');
  }

  const payload = buildSpeechPayload({
    model: params.model || config.ttsModel,
    voice: params.voice || config.ttsVoice,
    input: params.input,
    instructions: params.instructions,
    responseFormat: params.responseFormat || 'wav'
  });

  try {
    const response = await postWithRetries(`${config.baseUrl}/audio/speech`, payload, {
      requestConfig: {
        headers: buildHeaders(apiKey),
        timeout: params.timeoutMs || 120000,
        responseType: 'arraybuffer'
      },
      maxAttempts: params.maxAttempts || 3
    }, deps);

    return Buffer.isBuffer(response.data) ? response.data : Buffer.from(response.data);
  } catch (error) {
    throw new Error(normalizeProviderError(error));
  }
}

module.exports = {
  createStructuredResponse,
  synthesizeSpeech,
  getOpenAIConfig,
  normalizeProviderError,
  __private: {
    parseBooleanEnv,
    buildStructuredResponsePayload,
    buildSpeechPayload,
    extractResponseText,
    extractParsedOutput,
    sleep
  }
};
