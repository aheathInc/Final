import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { serverGet } from '@/lib/serverToken';
import { PageHeader } from '@/components/ui';
import { ProfileForm } from '@/components/ProfileForm';

interface Me { full_name: string | null; email: string | null; phone_number: string | null; preferred_language: string | null }
interface Health { status: string; dependencies?: Record<string, string> }

export default async function SettingsPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  const me = await serverGet<Me>('/users/me');

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <PageHeader title="Mipangilio" lede="Akaunti yako ya uendeshaji." />
      <ProfileForm
        initialName={me?.full_name ?? ''}
        initialLanguage={me?.preferred_language ?? 'sw'}
        email={me?.email ?? null}
        phone={me?.phone_number ?? null}
      />
    </div>
  );
}
