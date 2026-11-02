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
  'patient.peer_invitation': {sw:()=> 'A-Health: Una invitation mpya ya peer chat. Fungua app kuchagua kukubali au kukataa.',en:()=> 'A-Health: You have a peer chat invitation. Open the app to accept or decline.'},
  'patient.peer_message': {sw:()=> 'A-Health: Una ujumbe mpya. Fungua app kuusoma kwa faragha.',en:()=> 'A-Health: You have a new message. Open the app to read it privately.'},
  'patient.community_review': {sw:()=> 'A-Health: Post yako ina taarifa mpya ya moderation. Fungua community kwenye app.',en:()=> 'A-Health: Your community post has a moderation update. Open the app.'},
  'patient.report_resolved': {sw:()=> 'A-Health: Ripoti yako imefanyiwa kazi. Fungua app kuona taarifa.',en:()=> 'A-Health: Your safety report has been reviewed. Open the app for details.'},
  'patient.feedback_updated': {sw:()=> 'A-Health: Feedback yako ina taarifa mpya. Fungua Fuatilia feedback kwenye app.',en:()=> 'A-Health: Your feedback has an update. Open feedback tracking in the app.'},
  'payment.verified': {
    sw:(v)=>`A-Health: Malipo ya ${v.reference??'bili yako'} yamethibitishwa. Fungua A-Health kwa risiti.`,
    en:(v)=>`A-Health: Payment for ${v.reference??'your bill'} is verified. Open A-Health for your receipt.`,
  },
  'payment.simulated': {
    sw:()=> 'A-Health MAJARIBIO: Hali ya malipo ya mfano imesasishwa. Hakuna fedha halisi zilizothibitishwa.',
    en:()=> 'A-Health TEST: Sandbox payment updated. No real funds were verified.',
  },
  'thread.message': {
    sw: (v) => `A-health: ${v.sender ?? 'Daktari'} amekutumia ujumbe. Fungua A-Health au tumia huduma ya USSD iliyoidhinishwa.`,
    en: (v) => `A-health: ${v.sender ?? 'Your clinician'} sent you a message. Open A-Health or use the approved USSD service.`,
  },
  'consultation.assigned': {
    sw: () => 'A-health: Daktari amepokea ombi lako. Fungua A-Health au tumia USSD iliyoidhinishwa.',
    en: () => 'A-health: A clinician has picked up your request. Open A-Health or use the approved USSD service.',
  },
  'consultation.completed': {
    sw: () => 'A-health: Una taarifa mpya. Fungua A-Health kwa maelezo.',
    en: () => 'A-health: You have an update. Open A-Health for details.',
  },
  'referral.update': {
    sw: () => 'A-health: Kuna taarifa mpya ya rufaa yako. Fungua app kuangalia hali na hatua zinazofuata.',
    en: () => 'A-health: Your referral has an update. Open the app to view its status and next steps.',
  },
  // Deliberately generic: prescription and medication details never go to ordinary SMS.
  'prescription.handoff_ready': {
    sw: () => 'A-health: Agizo lako lina taarifa mpya. Fungua app kwa maelezo salama.',
    en: () => 'A-health: Your prescription has a secure update. Open the app for details.',
  },
  'prescription.fulfilment_update': {
    sw: () => 'A-health: Agizo lako la dawa limesasishwa. Fungua app kwa maelezo salama.',
    en: () => 'A-health: Your prescription fulfilment has changed. Open the app for details.',
  },
  // No drug/dose instructions, reply promise or unprovisioned short code in these reminders.
  'care.dose_due': {
    sw: () => 'A-Health: Una kikumbusho kwenye mpango wako wa huduma. Fungua app kwa maelezo na uthibitisho.',
    en: () => 'A-Health: You have a care-plan reminder. Open the app for details and confirmation.',
  },
  'care.checkin_due': {
    sw: () => 'A-Health: Ufuatiliaji wako unasubiri jibu. Fungua app kujibu au kuwasiliana na daktari wako.',
    en: () => 'A-Health: Your follow-up check-in is due. Open the app to respond or contact your care team.',
  },
  'adherence.reminder': {
    sw: () => 'A-health: Una kikumbusho cha huduma. Fungua app au wasiliana na timu yako kwa maelezo.',
    en: () => 'A-health: You have a care reminder. Open the app or contact your care team for details.',
  },
  'checkin.due': {
    sw: () => 'A-health: Ni wakati wa kujibu maswali ya ufuatiliaji. Fungua A-Health.',
    en: () => 'A-health: Time for your follow-up check-in. Open A-Health.',
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
