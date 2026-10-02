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

export type PatientNavigationAction =
  | 'OPEN_DOCTORS'
  | 'START_CONSULTATION'
  | 'OPEN_APPOINTMENTS'
  | 'OPEN_DIAGNOSTICS'
  | 'OPEN_MEDICATIONS'
  | 'OPEN_PHARMACY'
  | 'OPEN_FAMILY'
  | 'OPEN_EDUCATION'
  | 'OPEN_PREVENTION'
  | 'OPEN_EMERGENCY'
  | 'OPEN_PRIVACY'
  | 'OPEN_FEEDBACK'
  | 'OPEN_INSURANCE_PAYMENTS';

/** The local development stub's deliberate unsupported-action test fixture. */
export type ChatNavigationAction = PatientNavigationAction | 'UNSUPPORTED_TEST_ACTION';

export interface ChatResult {
  text: string;
  modelVersion: string;
  /** True when the reply recognised a red flag and must not continue the conversation. */
  escalated: boolean;
  escalationReason?: string;
  /** Structured suggestion only; the Patient app applies its own strict allowlist. */
  navigationAction?: ChatNavigationAction;
}

export interface ChatAdapter {
  readonly modelKey: string;
  complete(messages: ChatMessage[]): Promise<ChatResult>;
}

/**
 * Deterministic, offline navigation and red-flag rules for local development.
 * This is not a clinical model and does not receive patient records.
 */
export const stubChatAdapter: ChatAdapter = {
  modelKey: 'stub',
  async complete(messages) {
    const last = messages.filter((m) => m.role === 'user').at(-1)?.content ?? '';
    const lower = last.toLocaleLowerCase();

    const redFlags: [string[], string][] = [
      [['chest pain', 'maumivu makali ya kifua'], 'possible emergency'],
      [["can't breathe", 'can’t breathe', 'cannot breathe', 'siwezi kupumua'], 'possible emergency'],
      [['one side', 'upande mmoja wa mwili'], 'possible emergency'],
      [['suicidal', 'want to die', 'nataka kujiua'], 'possible emergency'],
      [['severe bleeding', 'damu nyingi'], 'possible emergency'],
      [['unconscious', 'amepoteza fahamu', 'nimepoteza fahamu'], 'possible emergency'],
    ];

    for (const [phrases, reason] of redFlags) {
      if (phrases.some((phrase) => lower.includes(phrase))) {
        return {
          text:
            'Huenda unahitaji msaada wa dharura sasa. Tafuta huduma ya dharura au kituo cha afya kilicho karibu. ' +
            'Msaidizi huyu hawezi kuthibitisha hali yako wala kutuma msaada.',
          modelVersion: 'stub-1',
          escalated: true,
          escalationReason: reason,
          navigationAction: 'OPEN_EMERGENCY',
        };
      }
    }

    if (lower.includes('unsupported navigation action fixture')) {
      return {
        text: 'Hii ni fixture ya majaribio. Kitendo hicho hakitumiki kwenye programu.',
        modelVersion: 'stub-1',
        escalated: false,
        navigationAction: 'UNSUPPORTED_TEST_ACTION',
      };
    }

    const intents: { phrases: string[]; action: PatientNavigationAction; text: string }[] = [
      {
        phrases: ['appointment', 'appointments', 'booking', 'miadi'],
        action: 'OPEN_APPOINTMENTS',
        text: 'Naweza kukuonyesha ukurasa wa miadi yako. Mabadiliko ya miadi yatahitaji hatua yako kwenye ukurasa huo.',
      },
      {
        phrases: ['pharmacy', 'pharmacies', 'famasia', 'duka la dawa'],
        action: 'OPEN_PHARMACY',
        text: 'Unaweza kuangalia upatikanaji wa dawa kwenye huduma ya famasia. Sitaanzisha agizo la dawa.',
      },
      {
        phrases: ['medication', 'prescription', 'medicine', 'dawa', 'maagizo'],
        action: 'OPEN_MEDICATIONS',
        text: 'Naweza kukuonyesha mahali pa kuona maagizo na dawa zako. Siwezi kushauri dozi au kubadilisha agizo.',
      },
      {
        phrases: ['diagnostic', 'test result', 'results', 'majibu ya vipimo', 'kipimo', 'vipimo'],
        action: 'OPEN_DIAGNOSTICS',
        text: 'Majibu yanapatikana kwenye ukurasa wa vipimo. Tafsiri ya matokeo ifanywe na clinician wako.',
      },
      {
        phrases: [
          'privacy',
          'consent',
          'records access',
          'access to my records',
          'manage access',
          'faragha',
          'ruhusa',
        ],
        action: 'OPEN_PRIVACY',
        text: 'Unaweza kuona na kudhibiti ruhusa za rekodi zako kwenye ukurasa wa faragha.',
      },
      {
        phrases: ['emergency', 'sos', 'dharura'],
        action: 'OPEN_EMERGENCY',
        text: 'Unaweza kufungua ukurasa wa SOS. Hakuna ombi la dharura litakalotumwa bila hatua yako.',
      },
      {
        phrases: ['family', 'dependent', 'dependant', 'familia', 'wategemezi'],
        action: 'OPEN_FAMILY',
        text: 'Naweza kukuonyesha ukurasa wa familia na wategemezi unaoruhusiwa kusimamia.',
      },
      {
        phrases: ['education', 'health information', 'elimu'],
        action: 'OPEN_EDUCATION',
        text: 'Naweza kukuonyesha makala za elimu ya afya zilizopo kwenye programu.',
      },
      {
        phrases: ['prevention', 'screening', 'vaccination', 'chanjo', 'kinga'],
        action: 'OPEN_PREVENTION',
        text: 'Naweza kukuonyesha huduma za kinga na uchunguzi zilizopo.',
      },
      {
        phrases: ['feedback', 'complaint', 'malalamiko', 'maoni'],
        action: 'OPEN_FEEDBACK',
        text: 'Naweza kukuonyesha ukurasa wa maoni na malalamiko.',
      },
      {
        phrases: ['insurance', 'payment', 'bima', 'malipo'],
        action: 'OPEN_INSURANCE_PAYMENTS',
        text: 'Naweza kukuonyesha taarifa za bima na rekodi za malipo zilizopo.',
      },
      {
        phrases: ['find a doctor', 'find doctor', 'doctors', 'tafuta daktari'],
        action: 'OPEN_DOCTORS',
        text: 'Naweza kukuonyesha orodha ya madaktari na vituo vilivyopo.',
      },
      {
        phrases: ['doctor', 'clinician', 'consultation', 'speak to a doctor', 'daktari', 'zungumza na daktari'],
        action: 'START_CONSULTATION',
        text: 'Unaweza kufungua ombi la kuwasiliana na clinician. Ombi halitatumwa hadi uthibitishe kwenye ukurasa unaofuata.',
      },
    ];

    const intent = intents.find(({ phrases }) => phrases.some((phrase) => lower.includes(phrase)));
    if (intent) {
      return {
        text: intent.text,
        modelVersion: 'stub-1',
        escalated: false,
        navigationAction: intent.action,
      };
    }

    return {
      text:
        'Naweza kukupeleka kwenye huduma zilizopo kwenye A-Health, lakini siwezi kutambua ugonjwa, kutafsiri majibu au kuagiza dawa. ' +
        'Uliza kuhusu miadi, daktari, dawa, vipimo au faragha.',
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
      // Model text is never parsed as an application action. The model adapter
      // does not provide navigation metadata; only governed adapter output can.
      return { text, modelVersion: payload.model ?? config.modelName, escalated: false };
    },
  };
}
