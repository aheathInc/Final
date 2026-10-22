import { requireRole } from '@/lib/roles';

export default async function DoctorLayout({ children }: { children: React.ReactNode }) {
  await requireRole(['clinician']);
  return children;
}
