import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { serverGet } from '@/lib/serverToken';
import { PageHeader } from '@/components/ui';
import { AssistantChat } from '@/components/AssistantChat';
import { DrugInteractions } from '@/components/DrugInteractions';

interface Model { key: string; display_name: string; status: string; runtime: string }

export default async function AssistantPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  const models = await serverGet<{ data: Model[] }>('/ai/models');
  const active = (models?.data ?? []).filter((m) => m.status === 'active');

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <PageHeader
        title="Msaidizi"
        lede="Msaidizi hautoi utambuzi. Anachotoa ni mapendekezo ya kuzingatia, na uamuzi unabaki wako."
      />

      {/*
        Which model is answering is not a detail to hide. A clinician weighing
        a suggestion should know whether it came from a deployed medical model
        or the rule-based fallback that runs when none is configured.
      */}
      <p className="mt-4 text-sm text-ink-soft">
        Inayotumika sasa: {active.length > 0 ? active.map((m) => m.display_name).join(', ') : 'hakuna'}
        {active.some((m) => m.key === 'stub') && ' — hii ni mantiki ya kanuni, si modeli ya AI iliyowekwa.'}
      </p>

      <AssistantChat />
      <DrugInteractions />
    </div>
  );
}
