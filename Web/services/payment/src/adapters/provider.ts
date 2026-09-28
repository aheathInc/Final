/**
 * The seam every mobile money provider sits behind.
 *
 * Adding Tigo Pesa or Airtel Money — or replacing a stub with the real
 * gateway — is a new adapter implementing this interface, never a change to
 * the calling code in intent.service.ts.
 */

export interface InitiateResult {
  providerReference: string;
  /** What the payer must do next — a USSD prompt, a reference code. Shape varies by provider. */
  clientAction: Record<string, unknown>;
}

export interface ProviderAdapter {
  readonly provider: 'mpesa' | 'tigo_pesa' | 'airtel_money';
  initiate(input: { amount: number; currency: string; payerPhone: string; reference: string }): Promise<InitiateResult>;
}

/** Development. Never calls out; the "prompt" is printed, not sent. */
export function createConsoleAdapter(provider: ProviderAdapter['provider']): ProviderAdapter {
  return {
    provider,
    async initiate(input) {
      const reference = `console-${provider}-${Date.now()}`;
      // Phone is masked, amount is not sensitive on its own. No secret ever
      // reaches this log.
      console.log(`[${provider}] would push a payment prompt`, {
        to: input.payerPhone.slice(0, 6) + '****',
        amount: input.amount,
        reference,
      });
      return {
        providerReference: reference,
        clientAction: { type: 'ussd_prompt', message: `Confirm payment of ${input.amount} ${input.currency} on your phone.` },
      };
    },
  };
}
