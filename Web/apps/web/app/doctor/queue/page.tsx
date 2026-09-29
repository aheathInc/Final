import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { Card, PageShell } from '@/components/ui';
import { QueueView } from '@/components/QueueView';
import { AvailabilityToggle } from '@/components/AvailabilityToggle';

export default async function QueuePage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  return (
    <PageShell>
      <header className="clinical-hero p-6 shadow-lg shadow-navy/10 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-teal">Doctor / Clinician</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">
              {session.user?.name ? `Dr. ${session.user.name}` : 'Clinical queue'}
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-200">
              Cases are ordered by urgency, offer state and time remaining. Accepting a case opens the live consultation workspace.
            </p>
          </div>
          <div className="rounded-lg border border-white/15 bg-white/10 p-3 backdrop-blur">
            <AvailabilityToggle />
          </div>
        </div>
      </header>

      <Card className="mt-5 p-0">
        <QueueView />
      </Card>
    </PageShell>
  );
}
