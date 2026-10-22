import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { serverGet } from '@/lib/serverToken';
import { Card, Empty, PageHeader } from '@/components/ui';

interface Family {
  id: string;
  name: string;
  subscription_tier: string;
  members: { id: string; patient_profile_id: string; full_name: string; relationship: string }[];
  gp_clinician: { id: string; full_name: string | null } | null;
  obgyn_clinician: { id: string; full_name: string | null } | null;
}

export default async function FamiliesPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  const family = await serverGet<Family>('/families/me');

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <PageHeader
        title="Familia"
        lede="Mfano wa daktari mmoja kwa familia moja: daktari wa jumla na daktari wa uzazi hupangwa kando."
      />

      {!family ? (
        <Empty>Hujapangiwa familia yoyote bado. Msimamizi ndiye anayepanga familia kwa madaktari.</Empty>
      ) : (
        <div className="mt-6 flex flex-col gap-4">
          <Card>
            <p className="font-medium">{family.name}</p>
            <p className="mt-1 text-sm text-ink-soft">Kifurushi: {family.subscription_tier}</p>
            <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-1 text-sm">
              <div>
                <dt className="text-ink-soft">Daktari wa jumla</dt>
                <dd>{family.gp_clinician?.full_name ?? 'Hajapangwa'}</dd>
              </div>
              <div>
                <dt className="text-ink-soft">Daktari wa uzazi</dt>
                <dd>{family.obgyn_clinician?.full_name ?? 'Hajapangwa'}</dd>
              </div>
            </dl>
          </Card>

          <h2 className="mt-4 text-sm font-semibold uppercase tracking-wide text-ink-soft">
            Wanafamilia ({family.members.length})
          </h2>
          <ul className="flex flex-col gap-2">
            {family.members.map((m) => (
              <li key={m.id} className="border border-line bg-white p-3">
                <span className="font-medium">{m.full_name}</span>
                <span className="ml-2 text-sm text-ink-soft">{m.relationship}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
