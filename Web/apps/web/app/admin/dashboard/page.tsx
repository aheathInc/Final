import Link from 'next/link';
import { Badge, PageHeader, Card, PageShell } from '@/components/ui';
import { serverGet } from '@/lib/serverToken';
import type { ClinicianProfile, Device, EmergencyRequest, Facility, IncidentReport, Page, Payment } from '@/lib/api';

function Stat({ label, value, href }: { label: string; value: number | string; href: string }) {
  return (
    <Link href={href} className="rounded-lg border border-line bg-white/95 p-4 shadow-sm shadow-navy/5 transition-colors hover:border-teal focus-visible:outline-petrol">
      <span className="text-sm text-ink-soft">{label}</span>
      <strong className="mt-2 block text-3xl font-semibold text-ink">{value}</strong>
    </Link>
  );
}

export default async function AdminDashboard() {
  const [emergencies, verifications, payments, devices, facilities, incidents] = await Promise.all([
    serverGet<Page<EmergencyRequest>>('/emergency-requests?limit=20'),
    serverGet<Page<ClinicianProfile>>('/clinicians?verification_status=pending&limit=20'),
    serverGet<Page<Payment>>('/payments?limit=20'),
    serverGet<{ data: Device[] }>('/devices'),
    serverGet<Page<Facility>>('/facilities?limit=20'),
    serverGet<Page<IncidentReport>>('/incident-reports?limit=20'),
  ]);

  const openEmergencies = emergencies?.data?.filter((e) => e.status !== 'resolved' && e.status !== 'cancelled').length ?? 0;
  const pendingVerifications = verifications?.data?.filter((v) => v.verification_status === 'pending').length ?? 0;
  const activeDevices = devices?.data?.filter((d) => d.status !== 'revoked').length ?? 0;
  const openIncidents = incidents?.data?.filter((i) => i.status !== 'closed').length ?? 0;

  return (
    <PageShell>
      <Card className="bg-gradient-to-br from-white to-teal/10">
        <PageHeader
          title="Operations dashboard"
          lede="Authorised operational queues across emergency response, clinician verification, payments, devices, facilities and quality."
          action={<Badge tone="good">Local staff demo</Badge>}
        />
      </Card>

      <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Open emergencies" value={openEmergencies} href="/admin/emergency" />
        <Stat label="Pending verifications" value={pendingVerifications} href="/admin/verification" />
        <Stat label="Active devices" value={activeDevices} href="/admin/devices" />
        <Stat label="Open incidents" value={openIncidents} href="/admin/incidents" />
      </section>

      <section className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card>
          <h2 className="font-semibold">Payments</h2>
          <p className="mt-2 text-3xl font-semibold">{payments?.data?.length ?? 0}</p>
          <p className="text-sm text-ink-soft">Recent payment records available to operations.</p>
        </Card>
        <Card>
          <h2 className="font-semibold">Facilities</h2>
          <p className="mt-2 text-3xl font-semibold">{facilities?.data?.length ?? 0}</p>
          <p className="text-sm text-ink-soft">Facilities returned by the facilities service.</p>
        </Card>
        <Card>
          <h2 className="font-semibold">Service health</h2>
          <p className="mt-2 text-sm text-ink-soft">
            Empty counts can mean no current work or an unavailable upstream service; detail pages show the authoritative state.
          </p>
        </Card>
      </section>
    </PageShell>
  );
}
