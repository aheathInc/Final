/**
 * Binds a dataset name to a real, safely-aggregatable table and the fields
 * a researcher may group by. This is deliberately narrow: only categorical,
 * non-identifying fields (urgency, channel, status) are allow-listed —
 * nothing here can ever return a single patient's data, because the group-by
 * vocabulary itself has no identifying field to select.
 *
 * Adding a second dataset later means adding a second entry here with its
 * own allow-list, not opening the query interface up generically — a
 * generic "run any aggregate over any table" endpoint is a de-identification
 * hole waiting to be found.
 */
/** The only fields Prisma's groupBy will accept for this dataset — a literal
 * union, not `string[]`, so the cast at the call site stays type-checked
 * instead of falling back to `never`. */
export type AllowedGroupField = 'urgencyLevel' | 'channel' | 'status';

export interface DatasetBinding {
  datasetName: string;
  allowedGroupFields: AllowedGroupField[];
}

export const CONSULTATION_VOLUMES: DatasetBinding = {
  datasetName: 'Consultation volumes by urgency and channel',
  allowedGroupFields: ['urgencyLevel', 'channel', 'status'],
};

export const DATASET_BINDINGS: Record<string, DatasetBinding> = {
  [CONSULTATION_VOLUMES.datasetName]: CONSULTATION_VOLUMES,
};
