/**
 * The seam every chat-capable model sits behind.
 *
 * Swapping Llama 3.1 for MedGemma, or a stub for a live endpoint, is a config
 * change plus one new adapter implementing this interface — never a change to
 * the calling code in services/conversation.ts.
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatResult {
  text: string;
  modelVersion: string;
  /** True when the reply recognised a red flag and must not continue the conversation. */
  escalated: boolean;
  escalationReason?: string;
}

export interface ChatAdapter {
  readonly modelKey: string;
  complete(messages: ChatMessage[]): Promise<ChatResult>;
}

/**
 * Deterministic, offline, pattern-matched red flags. This is what the service
 * runs on by default — good enough to develop and test the whole request path
 * against without a GPU, a network call, or a bill.
 *
 * Never returns a diagnosis, by construction: there is no diagnosis logic
 * here to accidentally return one.
 */
export const stubChatAdapter: ChatAdapter = {
  modelKey: 'stub',
  async complete(messages) {
    const last = messages.filter((m) => m.role === 'user').at(-1)?.content ?? '';
    const lower = last.toLowerCase();

    const RED_FLAGS: [string, string][] = [
      ['chest pain', 'possible cardiac emergency'],
      ['can\u2019t breathe', 'respiratory emergency'],
      ['cannot breathe', 'respiratory emergency'],
      ['one side', 'possible stroke'],
      ['suicidal', 'mental health emergency'],
      ['want to die', 'mental health emergency'],
      ['severe bleeding', 'haemorrhage emergency'],
      ['unconscious', 'neurological emergency'],
    ];

    for (const [phrase, reason] of RED_FLAGS) {
      if (lower.includes(phrase)) {
        return {
          text:
            'What you are describing needs urgent in-person care right now. ' +
            'Please contact emergency services or go to the nearest facility immediately. ' +
            'I am not able to help further with this in chat.',
          modelVersion: 'stub-1',
          escalated: true,
          escalationReason: reason,
        };
      }
    }

    return {
      text:
        'Thanks for sharing that. I can give general health information, but I cannot diagnose ' +
        'or prescribe. For anything that concerns you, a clinician on this platform can see you. ' +
        'Would you like me to help you start a consultation?',
      modelVersion: 'stub-1',
      escalated: false,
    };
  },
};

/**
 * Targets any endpoint speaking the OpenAI chat-completions shape — this is
 * how a self-hosted Llama 3.1 or MedGemma behind vLLM/TGI is meant to be
 * reached, not called directly from application code.
 */
export function createOpenAiCompatibleAdapter(config: {
  modelKey: string;
  endpoint: string;
  apiKey: string;
  modelName: string;
}): ChatAdapter {
  return {
    modelKey: config.modelKey,
    async complete(messages) {
      const response = await fetch(`${config.endpoint}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
        },
        body: JSON.stringify({ model: config.modelName, messages, temperature: 0.2 }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) {
        throw new Error(`chat model returned ${response.status}`);
      }
      const payload = (await response.json()) as {
        choices?: { message?: { content?: string } }[];
        model?: string;
      };
      const text = payload.choices?.[0]?.message?.content ?? '';
      // The adapter itself never diagnoses or escalates by pattern-matching the
      // model's own words — escalation for a live model is a governed,
      // separately-tested classifier, not string matching on generated text.
      return { text, modelVersion: payload.model ?? config.modelName, escalated: false };
    },
  };
}
