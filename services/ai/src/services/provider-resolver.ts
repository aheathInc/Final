import { env } from '../config/env.js';
import { createOpenAiCompatibleAdapter, stubChatAdapter, type ChatAdapter } from '../adapters/chat.js';
import { stubTranscribeAdapter, type TranscribeAdapter } from '../adapters/transcribe.js';

export function resolveChatAdapter(): ChatAdapter {
  if (env.CHAT_PROVIDER === 'openai_compatible') {
    return createOpenAiCompatibleAdapter({
      modelKey: env.CHAT_MODEL_NAME,
      endpoint: env.CHAT_MODEL_ENDPOINT,
      apiKey: env.CHAT_MODEL_KEY,
      modelName: env.CHAT_MODEL_NAME,
    });
  }
  return stubChatAdapter;
}

export function resolveTranscribeAdapter(): TranscribeAdapter {
  return stubTranscribeAdapter;
}
