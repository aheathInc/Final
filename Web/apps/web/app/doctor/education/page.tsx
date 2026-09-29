import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { serverGet } from '@/lib/serverToken';
import type { Page } from '@/lib/api';
import { Card, Empty, PageHeader } from '@/components/ui';
import { NewArticle } from '@/components/NewArticle';

interface Topic { slug: string; name: string; category: string; article_count: number }
interface Article { slug: string; topic_slug?: string; title: string; summary: string; language: string; reviewed_by_id: string | null }

export default async function EducationPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  const topics = await serverGet<{ data: Topic[] }>('/education/topics');
  const articles = await serverGet<Page<Article>>('/education/articles?limit=30');

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <PageHeader
        title="Elimu ya afya"
        lede="Maudhui hayafikii mgonjwa hadi mtaalamu ayapitie. Rasimu inabaki isionekane."
      />

      <NewArticle topics={topics?.data ?? []} />

      <h2 className="mt-10 text-sm font-semibold uppercase tracking-wide text-ink-soft">
        Yaliyochapishwa
      </h2>
      {(articles?.data ?? []).length === 0 ? (
        <Empty>Hakuna makala yaliyochapishwa bado.</Empty>
      ) : (
        <ul className="mt-3 flex flex-col gap-3">
          {(articles?.data ?? []).map((a) => (
            <li key={`${a.slug}-${a.language}`}>
              <Card>
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <span className="font-medium">{a.title}</span>
                  <span className="text-sm text-ink-soft">{a.language.toUpperCase()}</span>
                </div>
                <p className="mt-1 text-[0.95rem] text-ink-soft">{a.summary}</p>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
