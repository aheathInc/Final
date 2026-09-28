/**
 * Message bodies, per language.
 *
 * Swahili first, and not as a translation of the English — a message read on a
 * feature phone in a rural ward is the primary case here, not the fallback.
 *
 * Kept under 160 characters wherever possible so one message is one SMS. Two
 * segments cost twice as much and arrive out of order often enough to matter.
 */

export type LanguageCode = 'sw' | 'en' | 'fr' | 'ha' | 'am';

type Template = (vars: Record<string, string>) => string;

const TEMPLATES: Record<string, Partial<Record<LanguageCode, Template>>> = {
  'thread.message': {
    sw: (v) => `A-health: ${v.sender ?? 'Daktari'} amekutumia ujumbe. Piga *150*88# au fungua app kusoma.`,
    en: (v) => `A-health: ${v.sender ?? 'Your clinician'} sent you a message. Dial *150*88# or open the app to read it.`,
  },
  'consultation.assigned': {
    sw: () => 'A-health: Daktari amepokea ombi lako. Fungua app au piga *150*88# kuendelea.',
    en: () => 'A-health: A clinician has picked up your request. Open the app or dial *150*88# to continue.',
  },
  'consultation.completed': {
    sw: () => 'A-health: Matibabu yako yamekamilika. Angalia ushauri na dawa kwenye app au *150*88#.',
    en: () => 'A-health: Your consultation is complete. See the advice and prescription in the app or on *150*88#.',
  },
  'adherence.reminder': {
    sw: (v) => `A-health: Ni wakati wa ${v.medication ?? 'dawa'} ${v.dosage ?? ''}. Jibu 1 umemeza, 2 hujameza.`.trim(),
    en: (v) => `A-health: Time for ${v.medication ?? 'your medicine'} ${v.dosage ?? ''}. Reply 1 if taken, 2 if not.`.trim(),
  },
  'checkin.due': {
    sw: () => 'A-health: Ni wakati wa kujibu maswali ya ufuatiliaji. Piga *150*88# au fungua app.',
    en: () => 'A-health: Time for your follow-up check-in. Dial *150*88# or open the app.',
  },
  'screening.invitation': {
    sw: (v) => `A-health: Umealikwa kupima ${v.programme ?? 'afya'}. Jibu 1 kukubali, 2 kukataa.`,
    en: (v) => `A-health: You are invited for ${v.programme ?? 'screening'}. Reply 1 to accept, 2 to decline.`,
  },
};

export function render(
  templateKey: string,
  language: LanguageCode,
  vars: Record<string, string> = {},
): string | null {
  const set = TEMPLATES[templateKey];
  if (!set) return null;
  // Falls back to Swahili, then English. A missing translation must never mean
  // a missing message.
  const template = set[language] ?? set.sw ?? set.en;
  return template ? template(vars) : null;
}

export const knownTemplates = Object.keys(TEMPLATES);
