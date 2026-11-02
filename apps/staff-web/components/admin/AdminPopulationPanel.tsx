import type { AdminAnalyticsReport } from './types';
import styles from './adminAnalytics.module.css';

type Count = AdminAnalyticsReport['regions'][number];
const number = (n: number) => new Intl.NumberFormat('en-TZ').format(n);

function Distribution({ rows, empty, limit = 8 }: { rows: Count[]; empty: string; limit?: number }) {
  if (!rows.length || rows.every((r) => r.count === null && !r.suppressed)) {
    return <div className={styles.empty}>{empty}</div>;
  }
  const visible = rows.filter((r) => r.count !== null);
  const max = Math.max(1, ...visible.map((r) => r.count ?? 0));
  return <div className={styles.bars} role="list">
    {rows.slice(0, limit).map((r) => <div className={styles.barRow} role="listitem" key={r.label}>
      <div className={styles.barLabel}><span title={r.label}>{r.label}</span><strong>{r.suppressed ? 'Suppressed' : r.count === null ? '—' : number(r.count)}</strong></div>
      <div className={styles.track} aria-hidden="true"><div className={r.suppressed ? styles.suppressed : styles.fill} style={{ width: r.suppressed ? '0%' : `${Math.max(0, (r.count ?? 0) / max * 100)}%` }} /></div>
    </div>)}
  </div>;
}

function MiniTrend({ rows }: { rows: Count[] }) {
  const valid = rows.filter((r) => r.count !== null);
  if (!valid.length) return <div className={styles.empty}>No publishable consultation counts for this period.</div>;
  const max = Math.max(1, ...valid.map((r) => r.count ?? 0));
  return <div className={styles.trend} role="list" aria-label="Monthly consultation request counts">
    {rows.map((r) => <div className={styles.trendItem} key={r.label} role="listitem" aria-label={`${r.label}: ${r.suppressed ? 'suppressed' : r.count === null ? 'not recorded' : number(r.count)}`}>
      <span className={styles.trendValue}>{r.count === null ? '—' : number(r.count)}</span>
      <div className={styles.trendTrack}><div style={{ height: `${(r.count ?? 0) / max * 100}%` }} /></div>
      <span className={styles.trendMonth}>{r.label.slice(5)}</span>
    </div>)}
  </div>;
}

function Panel({ title, subtitle, children, badge }: { title: string; subtitle: string; children: React.ReactNode; badge?: string }) {
  return <section className={styles.panel}>
    <header className={styles.panelHeader}><div><h2>{title}</h2><p>{subtitle}</p></div>{badge && <span className={styles.panelBadge}>{badge}</span>}</header>
    {children}
  </section>;
}

export function AdminPopulationPanel({ data }: { data: AdminAnalyticsReport }) {
  const stamp = new Date(data.generatedAt);
  return <section className={styles.section} aria-labelledby="population-heading">
    <div className={styles.heading}>
      <div><h2 id="population-heading">Health & Regional Insights</h2><p>A-Health records only. Demographics cover all registered profiles; clinical activity follows the selected period.</p></div>
      <div className={styles.freshness}><span className={styles.liveDot} />Updated {Number.isNaN(stamp.getTime()) ? 'unavailable' : stamp.toLocaleString('en-TZ', { timeZone: 'Africa/Dar_es_Salaam', dateStyle: 'medium', timeStyle: 'short' })}</div>
    </div>
    <div className={styles.metrics}>
      <div className={styles.metric}><span>Patient profiles</span><strong>{data.coverage.patientProfiles}</strong><small>Band, includes dependents</small></div>
      <div className={styles.metric}><span>Registered facilities</span><strong>{number(data.coverage.facilities)}</strong><small>All records</small></div>
      <div className={styles.metric}><span>Consultation requests</span><strong>{data.coverage.consultationRequests}</strong><small>Band, last {data.periodDays} days</small></div>
      <div className={styles.metric}><span>Signed clinical notes</span><strong>{data.coverage.signedNotesInPeriod}</strong><small>Band, last {data.periodDays} days</small></div>
    </div>
    <div className={styles.twoColumns}>
      <Panel title="Regional distribution" subtitle="All-time patient profiles by recorded region code" badge="Mikoa"><Distribution rows={data.regions} empty="No regional profile data recorded." limit={12}/></Panel>
      <Panel title="Recorded conditions" subtitle="Signed diagnosis codes; counts of notes, not disease prevalence" badge="ICD / coded"><Distribution rows={data.conditions} empty="No coded diagnoses available for this period." limit={10}/></Panel>
      <Panel title="Gender distribution" subtitle="All-time sex recorded on patient profiles" badge="Demographics"><Distribution rows={data.genders} empty="No sex data recorded." limit={5}/></Panel>
      <Panel title="Age groups" subtitle="All-time age calculated from birth dates, including unknown" badge="Demographics"><Distribution rows={data.ages} empty="No age information available." limit={7}/></Panel>
    </div>
    <Panel title="Care demand over time" subtitle="Monthly consultation requests recorded within the selected reporting window" badge="Trends"><MiniTrend rows={data.monthlyConsultations}/></Panel>
    <div className={styles.privacy}><strong>Data interpretation & privacy</strong><p>Nonzero counts below {data.privacy.minCell} are suppressed. Patient totals are reported as ranges. Missing age, sex and region remain “Not recorded”. AHP activity does not measure population disease rates, and diagnosis counts may include multiple notes per person. No identifiable records or free-text notes are included.</p></div>
  </section>;
}
