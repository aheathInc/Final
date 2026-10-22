export interface TranscribeResult {
  text: string;
  confidence: number;
  modelVersion: string;
}

export interface TranscribeAdapter {
  transcribe(audioKey: string, language: string): Promise<TranscribeResult>;
}

/** Deterministic placeholder — returns a fixed low-confidence transcript so the client's correction UI is exercised in development. */
export const stubTranscribeAdapter: TranscribeAdapter = {
  async transcribe(_audioKey, language) {
    return {
      text: language === 'sw' ? '[nakala ya jaribio]' : '[test transcript]',
      confidence: 0.4,
      modelVersion: 'stub-1',
    };
  },
};
