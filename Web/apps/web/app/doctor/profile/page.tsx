import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { serverGet } from '@/lib/serverToken';
import type { ClinicianProfile, Facility } from '@/lib/api';
import { AvailabilityToggle } from '@/components/AvailabilityToggle';
import { Badge, Card, Notice, PageHeader, PageShell } from '@/components/ui';

const pretty = (value: string) => value.replace(/_/g, ' ');

export default async function ProviderProfilePage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  const profile = await serverGet<ClinicianProfile>('/clinicians/me');
  const facility = profile?.facility_id
    ? await serverGet<Facility>(`/facilities/${profile.facility_id}`)
    : null;

  return (
    <PageShell>
      <PageHeader title="Provider profile" lede="Your identity, clinician registration, facility and current work availability." />

      {!profile ? (
        <div className="mt-6"><Notice>The clinician profile could not be loaded. Try again later.</Notice></div>
      ) : (
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <Card>
            <h2 className="text-lg font-semibold">Identity</h2>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <div><dt className="text-ink-soft">Name</dt><dd className="font-medium">{profile.full_name ?? session.user?.name ?? 'Not supplied'}</dd></div>
              <div><dt className="text-ink-soft">Email</dt><dd className="font-medium">{profile.email ?? session.user?.email ?? 'Not supplied'}</dd></div>
              <div><dt className="text-ink-soft">Account</dt><dd className="font-medium">{profile.account_status ? pretty(profile.account_status) : 'Not supplied'}</dd></div>
              <div><dt className="text-ink-soft">License</dt><dd className="font-medium">{profile.license_number}</dd></div>
            </dl>
          </Card>

          <Card>
            <h2 className="text-lg font-semibold">Clinician status</h2>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <div><dt className="text-ink-soft">Specialty</dt><dd className="font-medium capitalize">{pretty(profile.specialty)}</dd></div>
              <div>
                <dt className="text-ink-soft">Verification</dt>
                <dd className="mt-1">
                  <Badge tone={profile.verification_status === 'verified' ? 'good' : profile.verification_status === 'rejected' ? 'problem' : 'attention'}>
                    {pretty(profile.verification_status)}
                  </Badge>
                </dd>
              </div>
              <div><dt className="text-ink-soft">Facility</dt><dd className="font-medium">{facility?.name ?? (profile.facility_id ? 'Facility details unavailable' : 'No facility assigned')}</dd></div>
              <div><dt className="text-ink-soft">Languages</dt><dd className="font-medium">{profile.languages_spoken?.length ? profile.languages_spoken.join(', ') : 'Not supplied'}</dd></div>
              <div><dt className="text-ink-soft">Current assigned load</dt><dd className="font-medium">{profile.current_load ?? 'Unavailable'}</dd></div>
            </dl>
            {profile.rejection_reason && <p className="mt-4 text-sm text-clay">Verification note: {profile.rejection_reason}</p>}
            <p className="mt-4 text-xs text-ink-soft">Verification and facility membership are managed by Operations. This page is read-only for those fields.</p>
          </Card>

          <Card className="lg:col-span-2">
            <h2 className="text-lg font-semibold">Work availability</h2>
            <p className="mt-1 text-sm text-ink-soft">Availability is saved by the clinician service and controls eligibility for newly routed cases.</p>
            <div className="mt-4">
              <AvailabilityToggle
                initial={profile.is_available}
                initiallyVerified={profile.verification_status === 'verified'}
              />
            </div>
          </Card>
        </div>
      )}
    </PageShell>
  );
}
