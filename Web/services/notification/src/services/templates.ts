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
    sw: () => 'A-health: Una taarifa mpya. Fungua app au piga *150*88# kwa maelezo.',
    en: () => 'A-health: You have an update. Open the app or dial *150*88# for details.',
  },
  'adherence.reminder': {
    sw: () => 'A-health: Ni wakati wa dawa yako. Jibu 1 ikiwa umetumia, 2 ikiwa hujatumia.',
    en: () => 'A-health: It is time for your medicine. Reply 1 if taken, 2 if not.',
  },
  'checkin.due': {
    sw: () => 'A-health: Ni wakati wa kujibu maswali ya ufuatiliaji. Piga *150*88# au fungua app.',
    en: () => 'A-health: Time for your follow-up check-in. Dial *150*88# or open the app.',
  },
  'screening.invitation': {
    sw: () => 'A-health: Una taarifa mpya ya huduma ya afya. Fungua app kwa maelezo.',
    en: () => 'A-health: You have a new health-service update. Open the app for details.',
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
