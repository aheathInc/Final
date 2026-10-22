import { prisma } from '@a-health/database';

/**
 * The transaction-scoped client, derived from the singleton rather than
 * imported from @prisma/client.
 *
 * Rule for every service: never import @prisma/client directly. Under pnpm
 * each package can resolve its own copy of the generated client, so a direct
 * import compiles today and breaks after the next install for no visible
 * reason.
 */
export type TxClient = Omit<typeof prisma, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

/**
 * Records one mutation for GET /sync/changes.
 *
 * Called from day one even though sync ships much later: a row that was never
 * logged can never be synced, so starting late would leave every early record
 * permanently invisible to offline clients.
 */
export async function recordChange(
  tx: TxClient,
  input: {
    entity: string;
    entityId: string;
    op: 'create' | 'update' | 'delete';
    version: number;
    patientProfileId?: string | null;
    clinicianId?: string | null;
    careThreadId?: string | null;
  },
): Promise<void> {
  await tx.changeLog.create({
    data: {
      entity: input.entity,
      entityId: input.entityId,
      op: input.op,
      version: input.version,
      patientProfileId: input.patientProfileId ?? null,
      clinicianId: input.clinicianId ?? null,
      careThreadId: input.careThreadId ?? null,
    },
  });
}
