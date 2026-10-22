'use client';

import React, { Component, type FormEvent } from 'react';
import { api, errorMessage } from '@/lib/api';
import { ClinicalHero } from './premium/ClinicalHero';
import { Icon } from './premium/Icon';

export interface CareApi {
  get<T>(path: string): Promise<{ data: T }>;
  post<T>(path: string, body: unknown, options?: { headers: Record<string, string> }): Promise<{ data: T }>;
}
interface Cycle { id: string; patient_name: string; patient_profile_id: string; care_thread_id: string; start_date: string; end_date: string;
  status: string; outcome: string | null; review_due: boolean; unreviewed_checkins: number; version: number }
export interface Plan { id: string; version: number; status: string; start_date: string; timezone: string; times: string[] }
export interface CareMedicationItem { id: string; medication_name: string; dosage: string; frequency_per_day: number; duration_days: number; has_reports?: boolean; plan: Plan | null }
interface Contact { id: string; scheduled_at: string; channel: string; purpose: string; status: string; version: number; note?: string | null }
interface Detail {
  id: string; patient_name: string; patient_profile_id: string; care_thread_id: string; source_consultation_id: string;
  contact_phone: string | null; status: string; review_due: boolean; outcome: string | null; end_date: string; version: number;
  checkins: { id: string; scheduled_at: string; status: string; is_deviation: boolean; responses: unknown; deviation_reasons: unknown;
    reviewed_at: string | null; review_note: string | null; version: number }[];
  prescriptions: { id: string; status: string; can_schedule: boolean; items: CareMedicationItem[];
    recent_doses: { id: string; medication_name: string; scheduled_at: string; state: string }[]; doses_truncated: boolean }[];
  contacts: Contact[]; checkins_truncated: boolean; prescriptions_truncated: boolean; contacts_truncated: boolean;
}
interface Props { identityKey: string; client?: CareApi }
interface State {
  rows: Cycle[]; detail: Detail | null; loading: boolean; detailLoading: boolean; error: string | null; success: string | null;
  busy: boolean; next: string | null; tab: 'review' | 'schedule' | 'contacts'; filter: string; compact: boolean; search: string;
}
const date = (value: string) => new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const text = (value: unknown) => typeof value === 'string' ? value : JSON.stringify(value ?? {});
const statusLabels: Record<string, string> = { not_confirmed: 'Not confirmed', patient_reported_skipped: 'Skipped · patient reported',
  patient_reported_delayed: 'Delayed · patient reported', taken: 'Taken · patient reported', missed: 'Check-in unanswered',
  no_answer: 'No answer', timing_not_confirmed: 'Timing needs clinician review' };
const statusLabel = (value: string) => statusLabels[value] ?? value.replaceAll('_', ' ');

export function careRequestKey(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  // getRandomValues is also available in older local-preview browser contexts.
  // Never downgrade idempotency identifiers to Math.random.
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** All data uses authenticated BFF calls; client injection is for explicit preview/tests. */
export class CareContinuityWorkspace extends Component<Props, State> {
  state: State = { rows: [], detail: null, loading: true, detailLoading: false, error: null, success: null, busy: false,
    next: null, tab: 'review', filter: 'active', compact: false, search: '' };
  private generation = 0;
  private detailGeneration = 0;
  private mounted = false;
  private pendingKeys = new Map<string, string>();
  private get client(): CareApi { return this.props.client ?? api; }
  componentDidMount() { this.mounted = true; void this.load(); }
  componentDidUpdate(previous: Props) {
    if (previous.identityKey !== this.props.identityKey) {
      this.generation++; this.detailGeneration++; this.pendingKeys.clear();
      this.setState({ rows: [], detail: null, error: null, success: null, next: null, busy: false, search: '' }, () => { void this.load(); });
    }
  }
  componentWillUnmount() { this.mounted = false; this.generation++; this.detailGeneration++; this.pendingKeys.clear(); }
  private current(generation: number) { return this.mounted && this.generation === generation; }
  private async load(cursor?: string) {
    const generation = ++this.generation;
    this.detailGeneration++;
    this.setState({ loading: true, detailLoading: false, error: null });
    try {
      const response = await this.client.get<{ data: Cycle[]; meta: { next_cursor: string | null } }>(
        `/care-continuity/worklist?limit=30&status=${this.state.filter}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      if (!Array.isArray(response.data.data)) throw new Error('Invalid worklist response.');
      if (this.current(generation)) this.setState(s => ({ rows: cursor ? [...s.rows, ...response.data.data] : response.data.data,
        next: response.data.meta?.next_cursor ?? null }));
    } catch (error) { if (this.current(generation)) this.setState({ rows: [], detail: null, error: errorMessage(error, 'The follow-up service is unavailable. No clinical outcome was changed.') }); }
    finally { if (this.current(generation)) this.setState({ loading: false }); }
  }
  private async open(id: string) {
    const generation = this.generation, detailGeneration = ++this.detailGeneration;
    this.setState({ detail: null, detailLoading: true, error: null, success: null });
    try {
      const { data } = await this.client.get<Detail>(`/care-continuity/cycles/${id}`);
      if (this.current(generation) && detailGeneration === this.detailGeneration) this.setState({ detail: data });
    } catch (error) { if (this.current(generation) && detailGeneration === this.detailGeneration) this.setState({ error: errorMessage(error, 'This follow-up record could not be opened.') }); }
    finally { if (this.current(generation) && detailGeneration === this.detailGeneration) this.setState({ detailLoading: false }); }
  }
  private async write(path: string, body: unknown, success: string) {
    if (this.state.busy) return;
    const generation = this.generation, selected = this.state.detail?.id, owner = this.props.identityKey;
    const identity = `${path}:${JSON.stringify(body)}`;
    let key = this.pendingKeys.get(identity);
    if (!key) { key = careRequestKey(); this.pendingKeys.set(identity, key); }
    this.setState({ busy: true, error: null, success: null });
    try {
      await this.client.post(path, body, { headers: { 'Idempotency-Key': key } });
      if (!this.current(generation)) return;
      this.pendingKeys.delete(identity);
      await this.load();
      if (this.mounted && selected && this.props.identityKey === owner) await this.open(selected);
      if (this.mounted && this.props.identityKey === owner) this.setState({ success });
    } catch (error) { if (this.current(generation)) this.setState({ error: errorMessage(error, 'Not confirmed by the server. Refresh before making another clinical change.') }); }
    finally { if (this.mounted && this.props.identityKey === owner) this.setState({ busy: false }); }
  }
  private schedule(event: FormEvent<HTMLFormElement>, item: CareMedicationItem) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    void this.write(`/care-continuity/items/${item.id}/schedule`, { base_version: item.plan?.version ?? 0,
      timezone: String(form.get('timezone')), start_date: String(form.get('start_date')),
      times: String(form.get('times')).split(',').map(t => t.trim()).filter(Boolean) }, 'Clinician-selected reminder times saved.');
  }
  private contact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget), detail = this.state.detail;
    if (!detail) return;
    const scheduled = new Date(String(form.get('scheduled_at')));
    if (!Number.isFinite(scheduled.getTime())) { this.setState({ error: 'Choose a valid contact time.' }); return; }
    const body = { scheduled_at: scheduled.toISOString(), channel: String(form.get('channel')), purpose: String(form.get('purpose')) };
    const tag = JSON.stringify(body); let key = this.pendingKeys.get(`contact:${tag}`);
    if (!key) { key = careRequestKey(); this.pendingKeys.set(`contact:${tag}`, key); }
    void this.write(`/care-continuity/cycles/${detail.id}/contacts`, { ...body, request_key: key }, 'Contact scheduled. A phone call has not been placed.');
  }
  private review(event: FormEvent<HTMLFormElement>, id: string, version: number) {
    event.preventDefault(); const note = String(new FormData(event.currentTarget).get('note') ?? '');
    void this.write(`/care-continuity/check-ins/${id}/review`, { base_version: version, note }, 'Check-in review recorded. No recovery outcome was inferred.');
  }
  private renderReview(detail: Detail) {
    return <>
      {detail.review_due && <div className="care-alert care-alert-warn" role="status">The follow-up window has ended. Review is needed; recovery has not been assumed.</div>}
      <div className="care-section-title"><h3>Check-ins & clinical review</h3><span>Patient-reported information</span></div>
      {!detail.checkins.length && <p className="care-empty">No check-ins yet. Scheduled follow-up responses will appear here.</p>}
      {detail.checkins.map(c => <section key={c.id} className="care-checkin">
        <div className="care-row"><strong>{date(c.scheduled_at)}</strong><span className={`care-badge ${c.is_deviation && !c.reviewed_at ? 'care-attention' : ''}`}>{c.reviewed_at ? 'Reviewed' : c.is_deviation ? 'Review requested' : statusLabel(c.status)}</span></div>
        {c.responses != null && <pre className="care-response">{text(c.responses)}</pre>}
        {!c.reviewed_at && (c.status === 'responded' || new Date(c.scheduled_at) <= new Date()) && <form onSubmit={e => this.review(e, c.id, c.version)}>
          <label className="care-label" htmlFor={`review-${c.id}`}>Review note <span>Clinician-only</span></label>
          <textarea id={`review-${c.id}`} name="note" rows={2} maxLength={2000} placeholder="Document your review, not an automatic outcome." />
          <button type="submit" className="care-button care-secondary" disabled={this.state.busy}>Record review</button>
        </form>}
        {c.review_note && <p className="care-muted">{c.review_note}</p>}
      </section>)}
      {detail.checkins_truncated && <p role="status">Latest 100 check-ins shown.</p>}
      <div className="care-section-title"><h3>Recent medication reports</h3><span>Last 7 days · not a measure of recovery</span></div>
      <div className="care-table-scroll"><table className="care-table"><thead><tr><th>Medication</th><th>Scheduled</th><th>Report</th></tr></thead><tbody>
        {detail.prescriptions.flatMap(p => p.recent_doses).map(d => <tr key={d.id}><td>{d.medication_name}</td><td>{date(d.scheduled_at)}</td><td><span className="care-badge">{statusLabel(d.state)}</span></td></tr>)}
      </tbody></table></div>
      {!detail.prescriptions.some(p => p.recent_doses.length) && <p className="care-empty">No recent dose reports. Silence is not recorded as a skipped dose.</p>}
      {detail.status === 'active' && <details className="care-close"><summary>Record an explicit follow-up outcome</summary>
        <p className="care-muted">Only close after clinical review. Contact or elapsed time does not establish recovery.</p>
        <form onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); void this.write(`/follow-up-cycles/${detail.id}/close`,
          { outcome: String(f.get('outcome')), notes: String(f.get('notes') ?? '') }, 'Explicit follow-up outcome recorded.'); }}>
          <label className="care-label" htmlFor="close-outcome">Clinical outcome</label><select id="close-outcome" name="outcome" required defaultValue=""><option value="" disabled>Select after review</option><option value="recovered">Recovered</option><option value="escalated">Escalated</option><option value="lost_to_follow_up">Lost to follow-up</option></select>
          <label className="care-label" htmlFor="close-note">Closure note</label><textarea id="close-note" name="notes" maxLength={2000} rows={2}/>
          <label className="care-check"><input type="checkbox" required/> I have reviewed the record and confirm this outcome.</label>
          <button disabled={this.state.busy} className="care-button" type="submit">Confirm outcome & close</button>
        </form>
      </details>}
    </>;
  }
  private renderSchedules(detail: Detail) {
    return <>
      <div className="care-alert" role="note">Choose times agreed with the patient. This changes reminders only—not the prescription, dose or frequency. Existing reported doses require clinical review, not silent rescheduling.</div>
      {!detail.prescriptions.length && <p className="care-empty">No prescription is attached to this care thread.</p>}
      {detail.prescriptions.map(p => <section key={p.id} className="care-prescription">
        {p.items.map(item => <ReminderTimingForm key={item.id} item={item} busy={this.state.busy}
          canSchedule={p.can_schedule && p.status !== 'discontinued'} onSave={e => this.schedule(e, item)}
          onState={status => item.plan && void this.write(`/care-continuity/plans/${item.plan.id}/state`,
            { base_version: item.plan.version, status }, 'Reminder preference updated. The prescription is unchanged.')}/>)}
      </section>)}
    </>;
  }
  private renderContacts(detail: Detail) {
    const phone = detail.contact_phone?.replace(/[^+\d]/g, '');
    return <>
      <div className="care-alert" role="note">Schedule a conversation and record its outcome. Phone opens your device dialer; AHP does not place or verify the call.</div>
      <div className="care-actions">{phone && <a href={`tel:${phone}`} className="care-button care-secondary">Open phone dialer</a>}
        <a className="care-button care-secondary" href={`/doctor/case/${detail.source_consultation_id}`}>Open care conversation</a></div>
      {detail.status === 'active' && <form className="care-contact-form" onSubmit={e => this.contact(e)}>
        <h3>Plan the next contact</h3><div className="care-form-grid"><div><label className="care-label" htmlFor="contact-at">Date & time · {Intl.DateTimeFormat().resolvedOptions().timeZone}</label><input id="contact-at" type="datetime-local" name="scheduled_at" required/></div>
        <div><label className="care-label" htmlFor="contact-channel">Contact method</label><select id="contact-channel" name="channel"><option value="phone">Phone call</option><option value="chat">Care-thread chat</option></select></div></div>
        <label className="care-label" htmlFor="contact-purpose">Purpose <span>Visible to patient</span></label><input id="contact-purpose" name="purpose" maxLength={500} required placeholder="Follow-up on your care plan"/>
        <button type="submit" className="care-button" disabled={this.state.busy}>Schedule contact</button>
      </form>}
      <h3 className="care-subheading">Contact history</h3>
      {!detail.contacts.length && <p className="care-empty">No contacts have been scheduled yet.</p>}
      {detail.contacts.map(c => <section key={c.id} className="care-checkin"><div className="care-row"><strong>{date(c.scheduled_at)}</strong><span className="care-badge">{statusLabel(c.status)}</span></div><p>{c.purpose}</p><p className="care-muted">{c.channel === 'phone' ? 'Phone call' : 'Care-thread chat'}</p>
        {c.status === 'scheduled' && <form onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); void this.write(`/care-continuity/contacts/${c.id}/outcome`,
          { base_version: c.version, status: String(f.get('status')), note: String(f.get('note') ?? '') }, 'Contact outcome recorded; no clinical recovery was inferred.'); }}>
          <label className="care-label" htmlFor={`outcome-${c.id}`}>Contact outcome</label><select id={`outcome-${c.id}`} name="status" required defaultValue=""><option value="" disabled>Select an observed outcome</option><option value="completed">Contact completed</option><option value="no_answer">No answer</option><option value="cancelled">Cancelled</option></select>
          <label className="care-label" htmlFor={`note-${c.id}`}>Clinician-only note</label><textarea id={`note-${c.id}`} name="note" rows={2} maxLength={2000}/><button type="submit" disabled={this.state.busy} className="care-button care-secondary">Record outcome</button>
        </form>}{c.note && <p className="care-muted">{c.note}</p>}</section>)}
    </>;
  }
  render() {
    const { rows, detail, tab, busy, loading, error, success, compact } = this.state;
    return <div className={`care-workspace ${compact ? 'care-compact' : ''}`}>
      <ClinicalHero kind="followup" eyebrow="Follow-up" title="Patient follow-up"
        lede="Track progress, review check-ins and keep your patients on the right path."
        action={<><a className="care-button care-secondary" href="/doctor/follow-up/medication-times">Medication schedules</a><button className="care-button care-secondary" aria-pressed={compact} onClick={() => this.setState({ compact: !compact })}>{compact ? 'Comfortable view' : 'Compact view'}</button><button className="care-button" disabled={loading || busy} onClick={() => void this.load()}>Refresh worklist</button></>} />
      {error && <div className="care-alert care-alert-error" role="alert">{error}<button className="care-inline" onClick={() => void this.load()}>Reload</button></div>}
      {success && <div className="care-alert care-alert-success" role="status">{success}</div>}
      <div className={`care-layout ${!detail && !this.state.detailLoading ? 'care-layout--browse' : ''}`}><aside className="care-panel care-list"><div className="care-list-heading"><h2>My follow-ups {!loading && <span className="care-count">({rows.length})</span>}</h2><label className="care-sr-only" htmlFor="care-filter">Cycle status</label><select id="care-filter" value={this.state.filter} disabled={busy} onChange={e => this.setState({ filter: e.target.value, detail: null }, () => void this.load())}><option value="active">Active</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select></div>
        <div className="ahp-followup-tools"><label className="ahp-filter-input"><Icon name="search" size={17}/><span className="sr-only">Filter loaded follow-up patients</span><input value={this.state.search} type="search" placeholder="Search loaded patients…" onChange={e=>this.setState({search:e.target.value})}/></label><span className="ahp-caption">{rows.filter(row=>row.review_due).length} windows need review</span></div>
        {loading && <p className="care-empty" role="status">Loading authorized follow-up records…</p>}
        {!loading && !error && !rows.length && <p className="care-empty">No {this.state.filter} cycles. Follow-up plans created during consultation completion appear here.</p>}
        {rows.filter(row=>row.patient_name.toLowerCase().includes(this.state.search.toLowerCase())).map(row => <button key={row.id} className={`care-patient ${detail?.id === row.id ? 'care-selected' : ''}`} disabled={busy} onClick={() => void this.open(row.id)} aria-pressed={detail?.id === row.id}>
          <span className="care-avatar" aria-hidden="true">{row.patient_name.split(' ').map(word => word[0]).slice(0, 2).join('')}</span><span className="care-patient-copy"><strong>{row.patient_name}</strong><small>{row.unreviewed_checkins ? `${row.unreviewed_checkins} check-in(s) to review` : row.review_due ? 'Review follow-up window' : 'Care plan in progress'}</small></span><span className={`care-badge ${row.review_due ? 'care-attention' : ''}`}>{row.review_due ? 'Review due' : statusLabel(row.status)}</span><span className="care-row-date">Ends {new Date(row.end_date).toLocaleDateString()}</span><span className="care-review-label">Review <Icon name="chevron" size={13}/></span>
        </button>)}
        {!loading && !error && rows.length>0 && !rows.some(row=>row.patient_name.toLowerCase().includes(this.state.search.toLowerCase())) && <p className="care-empty">No loaded patients match your search.</p>}
        {this.state.next && <button className="care-button care-secondary care-more" onClick={() => void this.load(this.state.next!)} disabled={loading || busy}>Load more</button>}
        <p className="care-list-note">Only your assigned follow-up cycles. No response ≠ recovery or a missed dose.</p>
      </aside>
      <section className="care-panel care-detail" aria-busy={this.state.detailLoading || busy}>
        {this.state.detailLoading ? <p className="care-empty" role="status">Opening care plan…</p> : !detail ? <div className="care-welcome"><div className="care-orbit" aria-hidden="true"><span>+</span></div><p className="care-eyebrow">THE NEXT STEP IN CARE</p><h2>A clearer view of<br/>every follow-up.</h2><p>Select a patient to review their responses, set agreed reminder times, or plan a conversation.</p></div> : <>
          <div className="care-detail-header"><div><p className="care-eyebrow">FOLLOW-UP RECORD</p><h2>{detail.patient_name}</h2><p className="care-muted">Window ends {date(detail.end_date)}</p></div><span className="care-badge">{detail.status}</span></div>
          <div className="care-tabs" role="tablist" aria-label="Follow-up sections">{(['review', 'schedule', 'contacts'] as const).map(key => <button key={key} role="tab" id={`tab-${key}`} aria-selected={tab === key} aria-controls="care-tab-panel" tabIndex={tab === key ? 0 : -1} onKeyDown={e => {
            const keys = ['review', 'schedule', 'contacts'] as const;
            const direction = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
            if (direction) { e.preventDefault(); const next = keys[(keys.indexOf(key) + direction + 3) % 3]!; this.setState({ tab: next }, () => document.getElementById(`tab-${next}`)?.focus()); }
          }} disabled={busy} onClick={() => this.setState({ tab: key })}>{key === 'review' ? 'Clinical review' : key === 'schedule' ? 'Medication timing' : 'Contact & follow-up'}</button>)}</div>
          <div role="tabpanel" id="care-tab-panel" aria-labelledby={`tab-${tab}`} className="care-tab-body">{tab === 'review' ? this.renderReview(detail) : tab === 'schedule' ? this.renderSchedules(detail) : this.renderContacts(detail)}</div>
        </>}
      </section></div>
      <footer className="care-footer">A-Health · Clinician-led follow-up <span>Reports are patient-declared. Reminders do not change prescriptions.</span></footer>
    </div>;
  }
}

export function ReminderTimingForm({ item, busy, canSchedule, onSave, onState }: {
  item: CareMedicationItem; busy: boolean; canSchedule: boolean;
  onSave: (event: FormEvent<HTMLFormElement>) => void; onState: (status: 'active' | 'paused') => void;
}) {
  const editable = canSchedule && item.plan?.status !== 'cancelled';
  return <div className="care-schedule">
    <div className="care-row"><div><h3>{item.medication_name}</h3><p className="care-muted">{item.dosage} · {item.frequency_per_day} times/day · {item.duration_days} days</p></div><span className="care-badge">{item.plan?.status ?? 'Needs timing'}</span></div>
    {item.plan && <p className="care-timing">{item.plan.times.join(' · ')} <span>{item.plan.timezone}</span></p>}
    {item.has_reports && <p className="care-alert" role="note">Dose reports already exist. This course cannot be restarted or silently rescheduled. A prescribing-clinician review is required.</p>}
    {editable && !item.has_reports ? <form onSubmit={onSave} key={`${item.id}:${item.plan?.version ?? 0}`}>
      <div className="care-form-grid"><div><label className="care-label" htmlFor={`start-${item.id}`}>Agreed start date</label><input id={`start-${item.id}`} type="date" name="start_date" required defaultValue={item.plan?.start_date ?? ''}/></div>
      <div><label className="care-label" htmlFor={`zone-${item.id}`}>Time zone</label><input id={`zone-${item.id}`} name="timezone" required defaultValue={item.plan?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone}/></div></div>
      <label className="care-label" htmlFor={`times-${item.id}`}>Daily times · {item.frequency_per_day} distinct time{item.frequency_per_day === 1 ? '' : 's'}</label>
      <input id={`times-${item.id}`} name="times" required placeholder="HH:mm, HH:mm" defaultValue={item.plan?.times.join(', ') ?? ''} aria-describedby={`hint-${item.id}`}/>
      <p id={`hint-${item.id}`} className="care-muted">24-hour times, separated by commas. No timing is guessed from frequency.</p>
      <button className="care-button" disabled={busy} type="submit">Save reminder times</button>
    </form> : !editable && <p className="care-muted">Only the verified prescribing clinician can configure an eligible schedule.</p>}
    {editable && item.plan && <div className="care-actions"><button className="care-button care-secondary" disabled={busy} type="button" onClick={() => onState(item.plan!.status === 'paused' ? 'active' : 'paused')}>{item.plan.status === 'paused' ? 'Resume reminders' : 'Pause reminders'}</button></div>}
  </div>;
}
