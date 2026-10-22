import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { PageHeader, Card, PageShell } from '@/components/ui';
import { MetricBars } from '@/components/premium/MetricBars';
import { Icon } from '@/components/premium/Icon';
import { serverGet } from '@/lib/serverToken';
import type { ClinicianDirectoryEntry, Device, EmergencyRequest, Facility, IncidentReport, Page, Payment } from '@/lib/api';

function Stat({ label, value, href }: { label: string; value: number | string; href: string }) {
  return (
    <Link href={href} className="ahp-stat">
      <span className="ahp-stat-label">{label}</span>
      <strong className="ahp-stat-value">{value}</strong><small className="ahp-stat-note">{value==='Unavailable'?'Source did not respond':'Within returned records'}</small>
    </Link>
  );
}

export default async function AdminDashboard() {
  const [emergencies, verifications, payments, devices, facilities, incidents, session] = await Promise.all([
    serverGet<Page<EmergencyRequest>>('/emergency-requests?limit=20'),
    serverGet<Page<ClinicianDirectoryEntry>>('/clinicians?verification_status=pending&limit=20'),
    serverGet<Page<Payment>>('/payments?limit=20'),
    serverGet<{ data: Device[] }>('/devices'),
    serverGet<Page<Facility>>('/facilities?limit=20'),
    serverGet<Page<IncidentReport>>('/incident-reports?limit=20'),
    getServerSession(authOptions),
  ]);

  const openEmergencies = emergencies?.data?.filter((e) => e.status !== 'resolved' && e.status !== 'cancelled').length ?? 0;
  const pendingVerifications = verifications?.data?.filter((v) => v.verification_status === 'pending').length ?? 0;
  const activeDevices = devices?.data?.filter((d) => d.status !== 'revoked').length ?? 0;
  const openIncidents = incidents?.data?.filter((i) => i.status !== 'closed').length ?? 0;

  return (
    <PageShell>
      <PageHeader title="Service overview" lede="A clear view of operations, outstanding work and the services supporting your care teams." />

      <section className="ahp-stat-grid">
        <Stat label="Open emergencies" value={emergencies ? openEmergencies : 'Unavailable'} href="/admin/emergency" />
        <Stat label="Pending verifications" value={verifications ? pendingVerifications : 'Unavailable'} href="/admin/verification" />
        <Stat label="Active devices" value={devices ? activeDevices : 'Unavailable'} href="/admin/devices" />
        <Stat label="Open incidents" value={incidents ? openIncidents : 'Unavailable'} href="/admin/incidents" />
      </section>

      <section className="ahp-bento">
        <Card><div className="ahp-section-heading"><h2>Care operations</h2><span className="ahp-caption">Choose your next action</span></div>
          {[
            {href:'/admin/verification',icon:'shield',title:'Clinician verification',description:verifications ? `${pendingVerifications} pending in returned records`:'Verification service unavailable'},
            {href:'/admin/facilities',icon:'building',title:'Healthcare facilities',description:facilities ? `${facilities.data.length} facilities in the current page`:'Facilities service unavailable'},
            {href:'/admin/payments',icon:'credit',title:'Payment records',description:payments ? `${payments.data.length} recent records · not a settlement total`:'Payment service unavailable'},
          ].map(x=><Link key={x.href} href={x.href} className="ahp-resource-link"><span><Icon name={x.icon}/></span><div><strong>{x.title}</strong><small>{x.description}</small></div><Icon name="chevron" size={16}/></Link>)}
        </Card>
        <Card><div className="ahp-section-heading"><h2>Connected & accountable</h2></div>
          {session?.user?.role === 'platform_admin' && <Link className="ahp-resource-link" href="/admin/interoperability"><span><Icon name="network"/></span><div><strong>External health systems</strong><small>Registry and identity review</small></div><Icon name="chevron" size={16}/></Link>}
          <Link className="ahp-resource-link" href="/admin/audit-ledger"><span><Icon name="history"/></span><div><strong>Audit ledger</strong><small>Inspect events and verify integrity</small></div><Icon name="chevron" size={16}/></Link>
          <div className="ahp-section-heading ahp-mt"><h2>Queues requiring attention</h2></div><MetricBars rows={[{label:'Emergency requests',value:emergencies?openEmergencies:null},{label:'Clinician verification',value:verifications?pendingVerifications:null},{label:'Open incidents',value:incidents?openIncidents:null}]} caption="Counts within returned records; not facility-wide totals."/>
          <p className="ahp-caption">Metrics reflect the records returned by each service, not hospital-wide totals. Unavailable sources are never shown as zero.</p>
        </Card>
      </section>
    </PageShell>
  );
}
