import { prisma } from '@a-health/database';
import { forbidden } from '@a-health/http';

export interface Caller { sub: string; role: string }
export interface Meta { ip?: string | null; requestId?: string | null }

function assertResearcher(caller: Caller) {
  if (caller.role !== 'researcher' && caller.role !== 'platform_admin') {
    throw forbidden('ROLE_NOT_PERMITTED', 'Only a registered researcher may query a dataset');
  }
}

function serialiseDataset(d: {
  id: string; name: string; description: string; deidentificationMethod: string;
  kAnonymity: number; minimumCellSize: number; requiresEthicsApproval: boolean;
  recordCount: number; isActive: boolean;
}) {
  return {
    id: d.id,
    name: d.name,
    description: d.description,
    deidentification_method: d.deidentificationMethod,
    k_anonymity: d.kAnonymity,
    minimum_cell_size: d.minimumCellSize,
    requires_ethics_approval: d.requiresEthicsApproval,
    record_count: null, // No operational record counts exposed by the legacy catalog.
  };
}

export async function listDatasets(caller: Caller) {
  assertResearcher(caller);
  const rows = await prisma.researchDataset.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } });
  return { data: rows.map(serialiseDataset) };
}

/** Legacy ethics-string queries are intentionally retired: no direct clinical aggregation. */
export async function submitQuery(
  caller: Caller,
  input: { dataset_id: string; ethics_approval_ref: string; query: { measure: string; group_by: string[] } },
  meta: Meta,
) {
  assertResearcher(caller);
  throw forbidden('FORBIDDEN', 'Legacy direct clinical aggregation is disabled. Submit an approved research project in the governed portal.');
}

export async function getQuery(id: string, caller: Caller) {
  assertResearcher(caller);
  throw forbidden('FORBIDDEN', 'Legacy query results are not released without current project authorization. Use the governed research portal.');
}
