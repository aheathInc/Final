'use client';

import React, { Component, type FormEvent } from 'react';
import { ClinicalHero } from './premium/ClinicalHero';
import { api, errorMessage } from '@/lib/api';
import { careRequestKey, ReminderTimingForm, type CareApi, type CareMedicationItem } from './CareContinuityWorkspace';
interface Prescription { id: string; patient_name: string; consultation_id: string; created_at: string; status: string; items: CareMedicationItem[] }
interface Props { identityKey: string; client?: CareApi }
interface State { rows: Prescription[]; loading: boolean; busy: boolean; error: string | null; success: string | null; next: string | null }
/** Medication planning does not require creating a follow-up cycle. */
export class MedicationTimingWorkspace extends Component<Props, State> {
  state: State = { rows: [], loading: true, busy: false, error: null, success: null, next: null };
  private alive = false;
  private generation = 0;
  private keys = new Map<string, string>();
  componentDidMount() { this.alive = true; void this.load(); }
  componentWillUnmount() { this.alive = false; this.generation++; this.keys.clear(); }
  componentDidUpdate(previous: Props) {
    if (previous.identityKey !== this.props.identityKey) {
      this.generation++; this.keys.clear();
      this.setState({ rows: [], error: null, success: null, next: null, busy: false }, () => { void this.load(); });
    }
  }
  private get client(): CareApi { return this.props.client ?? api; }
  private current(version: number) { return this.alive && version === this.generation; }
  private async load(cursor?: string) {
    const version = ++this.generation;
    this.setState({ loading: true, error: null });
    try {
      const { data } = await this.client.get<{ data: Prescription[]; meta: { next_cursor: string | null } }>(`/care-continuity/prescriptions?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      if (!Array.isArray(data.data)) throw new Error('Invalid prescription response.');
      if (this.current(version)) this.setState(s => ({ rows: cursor ? [...s.rows, ...data.data] : data.data, next: data.meta.next_cursor }));
    } catch (error) { if (this.current(version)) this.setState({ rows: [], error: errorMessage(error, 'Prescription schedules could not be loaded. No prescription was changed.') }); }
    finally { if (this.current(version)) this.setState({ loading: false }); }
  }
  private async write(path: string, body: unknown) {
    if (this.state.busy) return;
    const owner = this.props.identityKey, version = this.generation;
    const identity = `${path}:${JSON.stringify(body)}`;
    let key = this.keys.get(identity);
    if (!key) { key = careRequestKey(); this.keys.set(identity, key); }
    this.setState({ busy: true, error: null, success: null });
    try {
      await this.client.post(path, body, { headers: { 'Idempotency-Key': key } });
      if (!this.current(version)) return;
      this.keys.delete(identity); await this.load();
      if (this.alive && this.props.identityKey === owner) this.setState({ success: 'Reminder plan saved. Prescription contents and dose are unchanged.' });
    } catch (error) { if (this.current(version)) this.setState({ error: errorMessage(error, 'Schedule change was not confirmed. Refresh before retrying.') }); }
    finally { if (this.alive && this.props.identityKey === owner) this.setState({ busy: false }); }
  }
  private save(event: FormEvent<HTMLFormElement>, item: CareMedicationItem) {
    event.preventDefault(); const f = new FormData(event.currentTarget);
    void this.write(`/care-continuity/items/${item.id}/schedule`, { base_version: item.plan?.version ?? 0,
      start_date: String(f.get('start_date')), timezone: String(f.get('timezone')),
      times: String(f.get('times')).split(',').map(t => t.trim()).filter(Boolean) });
  }
  render() {
    const { rows, error, success, loading, busy, next } = this.state;
    return <div className="care-workspace">
      <ClinicalHero title="Medication schedules" kind="pharmacy" lede="Set clinician-selected reminder times for signed prescriptions. Reminders never change the prescription." action={<div className="care-header-actions"><a className="care-button care-secondary" href="/doctor/follow-up">Follow-up desk</a><button className="care-button" disabled={busy || loading} onClick={() => void this.load()}>Refresh prescriptions</button></div>}/>
      {error && <div className="care-alert care-alert-error" role="alert">{error}<button className="care-inline" onClick={() => void this.load()}>Reload</button></div>}
      {success && <p className="care-alert care-alert-success" role="status">{success}</p>}
      <div className="care-layout care-medication-layout"><section className="care-panel care-tab-body" aria-label="Your prescriptions">
        {loading ? <p role="status">Loading your signed prescriptions…</p> : !rows.length && !error ? <p className="care-empty">No eligible prescriptions found. Finalize the consultation and prescription through the existing clinical workflow first.</p> : rows.map(p => <section key={p.id}>
          <header className="care-prescription-head"><div className="care-row"><h2>{p.patient_name}</h2><span className="care-badge">{p.status}</span></div><p className="care-muted">{new Date(p.created_at).toLocaleDateString()} · <a href={`/doctor/case/${p.consultation_id}`}>Open signed care record</a></p></header>
          {p.items.map(item => <ReminderTimingForm key={item.id} item={item} busy={busy} canSchedule={true} onSave={e => this.save(e, item)} onState={status => item.plan && void this.write(`/care-continuity/plans/${item.plan.id}/state`, { base_version: item.plan.version, status })}/>)}
        </section>)}
        {next && <button className="care-button care-secondary" disabled={loading || busy} onClick={() => void this.load(next)}>Load more prescriptions</button>}
      </section><aside className="care-panel care-tab-body"><p className="care-eyebrow">PATIENT-AGREED TIMING</p><h2>Reminders support care.</h2><div className="care-section-title"><h3>One prescription, unchanged</h3></div><p className="care-muted">Dose, frequency and duration remain the signed clinician instructions. This screen only schedules reminders.</p><div className="care-section-title"><h3>Reported history is preserved</h3></div><p className="care-muted">A course with dose reports cannot be silently restarted or rescheduled. Review it clinically before issuing a replacement.</p><div className="care-section-title"><h3>Delivery is not intake</h3></div><p className="care-muted">Patients receive in-app reminders when the server and app are available. SMS requires opt-in and a configured provider. No reply means not confirmed—not a skipped dose.</p></aside></div>
    </div>;
  }
}
