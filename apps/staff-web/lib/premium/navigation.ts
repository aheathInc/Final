/** Navigation is presentation only. Existing server and BFF guards remain authoritative. */
export type NavigationItem = { label: string; href: string; icon: string };
export type NavigationGroup = { label: string; items: NavigationItem[] };
const item = (label: string, href: string, icon: string): NavigationItem => ({ label, href, icon });
export function navigationFor(role?: string): NavigationGroup[] {
  if (role === 'clinician') return [
    { label: 'Your workspace', items: [
      item('Consultation queue','/doctor/queue','home'), item('Appointments','/doctor/appointments','calendar'),
      item('Follow-up','/doctor/follow-up','heart'), item('Digital referrals','/doctor/referrals','send'),
      item('Diagnostics','/doctor/diagnostics','flask'), item('Hospital intake','/doctor/front-desk','building'),
    ] },
    { label: 'Connected care', items: [item('Clinical collaboration','/doctor/clinical-collaboration','users'),
      item('Care discussions','/doctor/network','message'), item('Second opinions','/doctor/second-opinions','shield'),
      item('Families','/doctor/families','users'), item('Pharmacy availability','/doctor/pharmacy','pill'),
      item('Assistant','/doctor/assistant','sparkles'), item('Health education','/doctor/education','book')] },
    { label: 'Your practice', items: [item('Provider profile','/doctor/profile','user'), item('Work history','/doctor/work-history','history'),
      item('Availability slots','/doctor/slots','clock'), item('Settings','/doctor/settings','settings')] },
  ];
  const admin=[item('Overview','/admin/dashboard','home'), item('Digital front desk','/admin/front-desk','building'),
    item('Emergency','/admin/emergency','activity'), item('Devices','/admin/devices','radio'),
    item('Clinician verification','/admin/verification','shield'), item('Facilities','/admin/facilities','building'),
    item('Incidents','/admin/incidents','alert'), item('Payments','/admin/payments','credit'),
    item('Interoperability','/admin/interoperability','network'), item('Audit ledger','/admin/audit-ledger','history'),
    item('Triage rules','/admin/triage','activity'), item('Settings','/admin/settings','settings')];
  const analytics=[item('Service overview','/analytics/dashboard','chart'),item('Surveillance','/analytics/surveillance','activity'),item('Research','/analytics/research','database')];
  if (role==='platform_admin') return [{label:'Operations',items:admin},{label:'Insights',items:analytics}];
  if (role==='researcher') return [{label:'Insights',items:analytics}];
  if (role==='dispatcher') return [{label:'Operations',items:admin.filter(x=>['/admin/emergency','/admin/devices'].includes(x.href))}];
  if (role==='facility_admin') return [{label:'Operations',items:admin.filter(x=>['/admin/facilities','/admin/incidents','/admin/settings'].includes(x.href))}];
  if (role==='pharmacist') return [{label:'Pharmacy',items:[item('Prescription handoff','/pharmacy','pill')]}];
  return [];
}
export function activeHref(path: string, href: string) { return path===href || path.startsWith(`${href}/`); }
export function roleLabel(role?: string) {
  return ({clinician:'Clinician', platform_admin:'Platform admin', pharmacist:'Pharmacist', researcher:'Research', dispatcher:'Dispatcher',facility_admin:'Facility admin'} as Record<string,string>)[role??''] ?? 'Staff workspace';
}
export type HeroKind = 'overview'|'followup'|'referrals'|'diagnostics'|'records'|'analytics'|'pharmacy'|'network';
export function heroFor(path: string): { kind: HeroKind; eyebrow: string; note: string; caption: string } {
  if(path.includes('follow-up')) return {kind:'followup',eyebrow:'Follow-up',note:'Continuity',caption:'Stay connected after care'};
  if(path.includes('referral')) return {kind:'referrals',eyebrow:'Referrals',note:'Secure sharing',caption:'Patient-authorized handoffs'};
  if(path.includes('diagnostic')) return {kind:'diagnostics',eyebrow:'Diagnostics',note:'Clear results',caption:'Clinician-led interpretation'};
  if(path.includes('/patients/') || path.includes('work-history')) return {kind:'records',eyebrow:'Patient records',note:'Connected history',caption:'Every source, clearly shown'};
  if(path.includes('pharmacy') || path.includes('medication')) return {kind:'pharmacy',eyebrow:'Pharmacy',note:'Safe fulfilment',caption:'Verified before dispensing'};
  if(path.includes('analytics') || path.includes('dashboard')) return {kind:'analytics',eyebrow:'Overview',note:'Data that matters',caption:'Evidence, not assumptions'};
  if(path.includes('interoperability') || path.includes('collaboration') || path.includes('network')) return {kind:'network',eyebrow:'Connected care',note:'Connected teams',caption:'Within authorized boundaries'};
  return {kind:'overview',eyebrow:'Your care workspace',note:'Patient first',caption:'More clarity. More care.'};
}
