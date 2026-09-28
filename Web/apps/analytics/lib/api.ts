import axios from 'axios';

export const api = axios.create({
  baseURL: '/bff',
  headers: { 'Content-Type': 'application/json' },
  timeout: 20000,
});

export function errorMessage(e: unknown, fallback: string): string {
  const err = e as { response?: { data?: { error?: { message?: string } } } };
  return err?.response?.data?.error?.message ?? fallback;
}

export type GeoLevel = 'ward' | 'district' | 'region' | 'national' | 'continental';

export interface ConditionCount {
  condition_code: string;
  condition_name: string;
  count: number;
  rate_per_100k: number | null;
  rank?: number;
  change_percent: number | null;
}

export interface TrendPoint {
  period: string;
  count: number;
  expected_low: number | null;
  expected_high: number | null;
  above_expected: boolean;
}

export interface TrendSeries {
  condition_code: string;
  level: GeoLevel;
  area_code: string | null;
  points: TrendPoint[];
  model_version: string | null;
}

export interface ResearchDataset {
  id: string;
  name: string;
  description: string;
  deidentification_method: string;
  k_anonymity: number;
  minimum_cell_size: number;
  requires_ethics_approval: boolean;
  record_count: number;
}

export interface ResearchQuery {
  id: string;
  dataset_id: string;
  ethics_approval_ref: string;
  query: { measure: string; group_by: string[] };
  status: 'queued' | 'running' | 'complete' | 'failed' | 'rejected';
  rows: Record<string, unknown>[];
  suppressed_cells: number;
  submitted_at: string;
  completed_at: string | null;
}
