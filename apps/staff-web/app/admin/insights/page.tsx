import { PageHeader, PageShell } from '@/components/ui';
import { RegionalInsights } from '@/components/admin/RegionalInsights';
import { requireRole } from '@/lib/roles';
export default async function InsightsPage() {
  await requireRole(['platform_admin']);
  return <PageShell><PageHeader title="Health & Regional Insights" lede="Explore diseases, reported cases and monthly trends in each recorded region and district."/><RegionalInsights/></PageShell>;
}
