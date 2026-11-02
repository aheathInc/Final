import { requireRole } from '@/lib/roles';

export default async function LabLayout({ children }: { children: React.ReactNode }) {
  await requireRole(['lab_technician']);
  return children;
}
