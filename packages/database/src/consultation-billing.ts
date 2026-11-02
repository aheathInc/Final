/** Server-recorded policy only; null is unknown, never a zero-price offer. */
export function isFreeConsultation(value: { consultationMode: string; consultationFeeAmount: unknown }) {
  return value.consultationMode === 'hospital' ||
    (value.consultationFeeAmount !== null && value.consultationFeeAmount !== undefined && Number(value.consultationFeeAmount) === 0);
}

export const otherCareChargesPolicy = 'Tests and medicines are separate from consultation fees. The facility must provide an itemized price and obtain patient approval before payment. A free consultation must never be converted into a consultation charge.';
