import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { serverGet } from '@/lib/serverToken';
import { PageHeader } from '@/components/ui';
import { RulesetManager } from '@/components/RulesetManager';

export interface Ruleset {
  id: string;
  label: string;
  status: 'draft' | 'active' | 'retired';
  rules: Record<string, unknown>;
  sla_seconds: { emergency: number; urgent: number; routine: number };
  notes: string | null;
  activated_at: string | null;
  created_at: string;
}

export default async function TriagePage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  const list = await serverGet<{ data: Ruleset[] }>('/triage-rulesets');

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <PageHeader
        title="Sheria za triage"
        lede="Kubadilisha kunatengeneza toleo jipya; toleo lililopo halibadilishwi kamwe. Kila kesi inahifadhi toleo lililoiamua, kwa hiyo uamuzi wa mwaka jana bado unaweza kuelezwa."
      />
      <RulesetManager rulesets={list?.data ?? []} />
    </div>
  );
}
