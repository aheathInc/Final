import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { serverGet } from '@/lib/serverToken';
import { PageHeader } from '@/components/ui';
import { ProfileForm } from '@/components/ProfileForm';
import { AvailabilityToggle } from '@/components/AvailabilityToggle';

interface Me {
  id: string;
  full_name: string | null;
  email: string | null;
  phone_number: string | null;
  preferred_language: string | null;
}

export default async function SettingsPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  const me = await serverGet<Me>('/users/me');

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <PageHeader title="Mipangilio" lede="Akaunti yako na upatikanaji wako." />

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-soft">Upatikanaji</h2>
        <div className="mt-3"><AvailabilityToggle /></div>
        <p className="mt-2 text-sm text-ink-soft">
          Ukiwa hupokei kesi, mfumo hautakupangia kesi mpya. Kesi ulizonazo zinabaki zako.
        </p>
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-soft">Akaunti</h2>
        <ProfileForm
          initialName={me?.full_name ?? ''}
          initialLanguage={me?.preferred_language ?? 'sw'}
          email={me?.email ?? null}
          phone={me?.phone_number ?? null}
        />
      </section>
    </div>
  );
}
