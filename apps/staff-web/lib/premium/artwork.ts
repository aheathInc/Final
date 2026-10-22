// Static imports are emitted under /_next/static/media by Next.js. This keeps
// the existing authentication middleware unchanged, including on /login.
import overview from '@/public/design/clinical/overview.svg';
import followup from '@/public/design/clinical/followup.webp';
import referrals from '@/public/design/clinical/referrals.svg';
import diagnostics from '@/public/design/clinical/diagnostics.svg';
import records from '@/public/design/clinical/records.svg';
import analytics from '@/public/design/clinical/analytics.svg';
import pharmacy from '@/public/design/clinical/pharmacy.svg';
import network from '@/public/design/clinical/network.svg';
export const clinicalArtwork: Record<string,{src:string}> = {overview,followup,referrals,diagnostics,records,analytics,pharmacy,network};
