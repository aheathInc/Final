import { createHash, timingSafeEqual } from 'node:crypto';
import { prisma, type Prisma } from '@a-health/database';
import {
  appendAudit, badRequest, conflict, forbidden, notFound, unprocessable,
} from '@a-health/http';
import {
  FHIR_RESOURCE_TYPES, type FhirResource, type FhirResourceType,
} from '../types/interop.types.js';

const MAX_RESOURCE_BYTES = 256 * 1024;
const supportedTypes = new Set<string>(FHIR_RESOURCE_TYPES);
const supportedReferenceTypes = new Set<string>(FHIR_RESOURCE_TYPES);
const clinicalTypes = new Set(['Encounter', 'Condition', 'Observation', 'DiagnosticReport', 'MedicationRequest', 'AllergyIntolerance']);

const allowedFields: Record<FhirResourceType, Set<string>> = {
  Patient: new Set(['resourceType', 'id', 'meta', 'identifier', 'active', 'name', 'gender', 'birthDate', 'managingOrganization']),
  Organization: new Set(['resourceType', 'id', 'meta', 'identifier', 'active', 'type', 'name', 'telecom', 'address']),
  Practitioner: new Set(['resourceType', 'id', 'meta', 'identifier', 'active', 'name', 'telecom', 'qualification']),
  Encounter: new Set(['resourceType', 'id', 'meta', 'identifier', 'status', 'class', 'type', 'subject', 'participant', 'period', 'serviceProvider', 'reasonCode', 'basedOn']),
  Condition: new Set(['resourceType', 'id', 'meta', 'identifier', 'clinicalStatus', 'verificationStatus', 'category', 'severity', 'code', 'bodySite', 'subject', 'encounter', 'onsetDateTime', 'onsetAge', 'onsetPeriod', 'onsetRange', 'onsetString', 'recordedDate', 'asserter']),
  Observation: new Set(['resourceType', 'id', 'meta', 'identifier', 'basedOn', 'partOf', 'status', 'category', 'code', 'subject', 'focus', 'encounter', 'effectiveDateTime', 'effectivePeriod', 'issued', 'performer', 'valueQuantity', 'valueCodeableConcept', 'valueString', 'valueBoolean', 'valueInteger', 'interpretation', 'bodySite', 'method', 'specimen', 'referenceRange', 'hasMember', 'derivedFrom']),
  DiagnosticReport: new Set(['resourceType', 'id', 'meta', 'identifier', 'basedOn', 'status', 'category', 'code', 'subject', 'encounter', 'effectiveDateTime', 'effectivePeriod', 'issued', 'performer', 'resultsInterpreter', 'specimen', 'result', 'imagingStudy', 'media', 'conclusion', 'conclusionCode']),
  MedicationRequest: new Set(['resourceType', 'id', 'meta', 'identifier', 'status', 'statusReason', 'intent', 'category', 'priority', 'doNotPerform', 'medicationCodeableConcept', 'subject', 'encounter', 'supportingInformation', 'authoredOn', 'requester', 'performer', 'reasonCode', 'reasonReference', 'dosageInstruction', 'dispenseRequest', 'substitution', 'priorPrescription', 'detectedIssue', 'eventHistory']),
  AllergyIntolerance: new Set(['resourceType', 'id', 'meta', 'identifier', 'clinicalStatus', 'verificationStatus', 'type', 'category', 'criticality', 'code', 'patient', 'encounter', 'onsetDateTime', 'onsetAge', 'onsetPeriod', 'onsetRange', 'onsetString', 'recordedDate', 'recorder', 'asserter', 'lastOccurrence', 'note', 'reaction']),
  Provenance: new Set(['resourceType', 'id', 'meta', 'target', 'occurredPeriod', 'occurredDateTime', 'recorded', 'policy', 'location', 'reason', 'activity', 'agent', 'entity', 'signature']),
};

type Caller = { sub: string; role: string; ppid?: string; cpid?: string };
type Meta = { ip?: string | null; requestId?: string | null };
type JsonObject = Record<string, unknown>;
type TimelineEntry = {
  id: string; category: string; occurred_at: string;
  source: { type: string; name: string; facility_name: string | null; record_id: string };
  status: string; verification_state: string; summary: string; detail: JsonObject;
  provenance?: JsonObject; _care_thread_id: string | null;
};

const isObject = (value: unknown): value is JsonObject =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const getObject = (value: unknown): JsonObject | null => isObject(value) ? value : null;
const getString = (value: unknown): string | null => typeof value === 'string' ? value : null;

function requiredString(value: unknown, field: string, max = 180): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > max) {
    throw unprocessable(`FHIR ${field} is required and must be within the supported length`);
  }
  return value;
}

function dateValue(value: unknown, field: string): Date {
  if (typeof value !== 'string') throw unprocessable(`FHIR ${field} must be a date-time`);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw unprocessable(`FHIR ${field} must be a valid date-time`);
  return parsed;
}

function parseReference(value: unknown, expectedType?: string): { type: string; id: string } {
  const reference = getString(getObject(value)?.reference);
  const match = reference?.match(/^([A-Z][A-Za-z]+)\/([A-Za-z0-9.-]{1,64})$/);
  if (!match || !supportedReferenceTypes.has(match[1]!) || (expectedType && match[1] !== expectedType)) {
    throw unprocessable('FHIR reference is outside the supported local-reference format');
  }
  return { type: match[1]!, id: match[2]! };
}

function validateFhirResource(input: unknown): FhirResource {
  if (!isObject(input)) throw unprocessable('FHIR resource must be a JSON object');
  const type = getString(input.resourceType);
  if (!type || !supportedTypes.has(type)) throw unprocessable('FHIR resource type is not supported');
  const resourceType = type as FhirResourceType;
  const extraFields = Object.keys(input).filter((key) => !allowedFields[resourceType].has(key));
  if (extraFields.length) throw unprocessable('FHIR resource contains fields outside the supported profile');
  const id = requiredString(input.id, 'id', 64);
  if (!/^[A-Za-z0-9.-]{1,64}$/.test(id)) throw unprocessable('FHIR resource id is invalid');
  const bytes = Buffer.byteLength(JSON.stringify(input), 'utf8');
  if (bytes > MAX_RESOURCE_BYTES) throw unprocessable('FHIR resource exceeds the supported payload size');
  inspectUnsupportedStructures(input);
  const meta = getObject(input.meta);
  if (input.meta !== undefined && !meta) throw unprocessable('FHIR meta must be an object');
  if (!meta || typeof meta.lastUpdated !== 'string') {
    throw unprocessable('FHIR meta.lastUpdated is required by the supported import profile');
  }
  if (meta) {
    const unsupportedMeta = Object.keys(meta).filter((key) => !['versionId', 'lastUpdated', 'profile'].includes(key));
    if (unsupportedMeta.length) throw unprocessable('FHIR meta contains fields outside the supported profile');
    if (meta.versionId !== undefined) requiredString(meta.versionId, 'meta.versionId', 80);
    if (meta.lastUpdated !== undefined) dateValue(meta.lastUpdated, 'meta.lastUpdated');
  }

  if (clinicalTypes.has(resourceType)) {
    const patientField = resourceType === 'AllergyIntolerance' ? 'patient' : 'subject';
    parseReference(input[patientField], 'Patient');
    const eventValue = eventDateValue(resourceType, input);
    if (!eventValue) throw unprocessable('FHIR clinical resource requires a supported clinical event timestamp');
    dateValue(eventValue, 'clinical event timestamp');
  }
  if (resourceType === 'Provenance') {
    if (!Array.isArray(input.target) || input.target.length < 1 || input.target.length > 20) {
      throw unprocessable('FHIR Provenance requires one or more supported targets');
    }
    for (const target of input.target) parseReference(target);
    dateValue(input.recorded, 'recorded');
  }
  if (resourceType === 'Encounter' && input.subject !== undefined) parseReference(input.subject, 'Patient');
  if (resourceType === 'Patient' && input.identifier !== undefined && !Array.isArray(input.identifier)) {
    throw unprocessable('FHIR Patient.identifier must be an array');
  }
  const references = collectReferences(input);
  if (clinicalTypes.has(resourceType)) {
    const patientId = resourcePatientReference(input as FhirResource);
    if (references.some((reference) => reference.type === 'Patient' && reference.id !== patientId)) {
      throw unprocessable('FHIR resource contains a Patient reference outside its subject identity');
    }
  }
  return input as FhirResource;
}

function collectReferences(value: unknown, output: Array<{ type: string; id: string }> = []) {
  if (Array.isArray(value)) {
    for (const child of value) collectReferences(child, output);
  } else if (isObject(value)) {
    if (typeof value.reference === 'string') output.push(parseReference(value));
    for (const child of Object.values(value)) collectReferences(child, output);
  }
  return output;
}

function inspectUnsupportedStructures(value: unknown, depth = 0): void {
  if (depth > 16) throw unprocessable('FHIR resource nesting exceeds the supported profile');
  if (Array.isArray(value)) {
    if (value.length > 1_000) throw unprocessable('FHIR resource collection exceeds the supported profile');
    for (const entry of value) inspectUnsupportedStructures(entry, depth + 1);
    return;
  }
  if (!isObject(value)) return;
  for (const [key, nested] of Object.entries(value)) {
    if (['extension', 'modifierExtension', 'contained', 'implicitRules'].includes(key) || key.startsWith('_')) {
      throw unprocessable('FHIR extensions and embedded resources are outside the supported profile');
    }
    if (typeof nested === 'string' && nested.length > 10_000) {
      throw unprocessable('FHIR text exceeds the supported profile limit');
    }
    inspectUnsupportedStructures(nested, depth + 1);
  }
}

function eventDateValue(type: FhirResourceType, resource: JsonObject): unknown {
  if (type === 'Encounter') return getObject(resource.period)?.start ?? getObject(resource.period)?.end;
  if (type === 'Condition' || type === 'AllergyIntolerance') return resource.onsetDateTime ?? resource.recordedDate;
  if (type === 'Observation') return resource.effectiveDateTime ?? getObject(resource.effectivePeriod)?.start ?? resource.issued;
  if (type === 'DiagnosticReport') return resource.effectiveDateTime ?? getObject(resource.effectivePeriod)?.start ?? resource.issued;
  if (type === 'MedicationRequest') return resource.authoredOn;
  if (type === 'Provenance') return resource.recorded;
  return null;
}

function eventDate(type: FhirResourceType, resource: JsonObject): Date | null {
  const value = eventDateValue(type, resource);
  return typeof value === 'string' ? new Date(value) : null;
}

function safeHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(sortObject(value))).digest('hex');
}

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObject);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortObject(value[key])]));
}

function tokenMatches(actual: string, expected: string): boolean {
  const left = createHash('sha256').update(actual).digest();
  const right = createHash('sha256').update(expected).digest();
  return timingSafeEqual(left, right);
}

export async function authenticateIntegration(systemKey: string | undefined, authorization: string | undefined) {
  if (!systemKey || !/^[a-z][a-z0-9-]{2,59}$/.test(systemKey)) {
    throw forbidden('FORBIDDEN', 'Integration client is not authorized');
  }
  const system = await prisma.externalHealthSystem.findUnique({ where: { systemKey } });
  const tokenName = `INTEROP_SYSTEM_TOKEN_${systemKey.toUpperCase().replace(/-/g, '_')}`;
  const expected = process.env[tokenName];
  const supplied = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!system || system.status !== 'active' || system.authConfigRef !== tokenName || !expected || !supplied || !tokenMatches(supplied, expected)) {
    throw forbidden('FORBIDDEN', 'Integration client is not authorized');
  }
  return { id: system.id, systemKey: system.systemKey, supportedTypes: system.supportedTypes };
}

function auditBase(caller: Caller | null, action: string, entityType: string, entityId: string | null, meta: Meta) {
  return {
    actorUserId: caller?.sub ?? null, action, entityType, entityId,
    ipAddress: meta.ip ?? null, requestId: meta.requestId ?? null,
  };
}

function serializeSystem(row: {
  id: string; systemKey: string; name: string; identifier: string; facilityId: string;
  status: string; supportedTypes: string[]; authConfigRef: string; activatedAt: Date | null;
  createdAt: Date; updatedAt: Date; facility: { name: string };
}) {
  return {
    id: row.id, system_key: row.systemKey, name: row.name, identifier: row.identifier,
    facility: { id: row.facilityId, name: row.facility.name }, status: row.status,
    supported_types: row.supportedTypes, authentication_configuration_reference: row.authConfigRef,
    activated_at: row.activatedAt?.toISOString() ?? null,
    created_at: row.createdAt.toISOString(), updated_at: row.updatedAt.toISOString(),
  };
}

export async function listSystems() {
  const rows = await prisma.externalHealthSystem.findMany({ include: { facility: { select: { name: true } } }, orderBy: { createdAt: 'desc' } });
  return { data: rows.map(serializeSystem) };
}

export async function registerSystem(caller: Caller, input: {
  system_key: string; name: string; identifier: string; facility_id: string; supported_types: string[];
}, meta: Meta) {
  const facility = await prisma.facility.findUnique({ where: { id: input.facility_id }, select: { id: true, name: true, isActive: true } });
  if (!facility || !facility.isActive) throw unprocessable('An active AHP facility is required');
  const authConfigRef = `INTEROP_SYSTEM_TOKEN_${input.system_key.toUpperCase().replace(/-/g, '_')}`;
  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.externalHealthSystem.create({
      data: {
        systemKey: input.system_key, name: input.name, identifier: input.identifier,
        facilityId: input.facility_id, supportedTypes: [...new Set(input.supported_types)],
        authConfigRef, createdByUserId: caller.sub,
      }, include: { facility: { select: { name: true } } },
    });
    await appendAudit({
      ...auditBase(caller, 'interop.system.registered', 'external_health_systems', created.id, meta),
      metadata: { status: created.status, facilityId: created.facilityId, supportedTypeCount: created.supportedTypes.length },
    }, tx);
    return created;
  });
  return serializeSystem(row);
}

export async function activateSystem(systemId: string, caller: Caller, meta: Meta) {
  const row = await prisma.$transaction(async (tx) => {
    const current = await tx.externalHealthSystem.findUnique({ where: { id: systemId } });
    if (!current) throw notFound('External system not found');
    const configuredToken = process.env[current.authConfigRef];
    if (!configuredToken || configuredToken.length < 32) {
      throw unprocessable('The source-specific integration credential must be configured through local secret management before activation');
    }
    const updated = await tx.externalHealthSystem.update({
      where: { id: systemId }, data: { status: 'active', activatedAt: new Date(), activatedByUserId: caller.sub, version: { increment: 1 } },
      include: { facility: { select: { name: true } } },
    });
    await appendAudit({
      ...auditBase(caller, 'interop.system.activated', 'external_health_systems', systemId, meta),
      metadata: { previousStatus: current.status, status: updated.status },
    }, tx);
    return updated;
  });
  return serializeSystem(row);
}

export async function suspendSystem(systemId: string, caller: Caller, meta: Meta) {
  const row = await prisma.$transaction(async (tx) => {
    const current = await tx.externalHealthSystem.findUnique({ where: { id: systemId } });
    if (!current) throw notFound('External system not found');
    if (current.status === 'suspended') return current;
    const updated = await tx.externalHealthSystem.update({ where: { id: systemId }, data: { status: 'suspended', version: { increment: 1 } } });
    await appendAudit({
      ...auditBase(caller, 'interop.system.suspended', 'external_health_systems', systemId, meta),
      metadata: { previousStatus: current.status, status: updated.status },
    }, tx);
    return updated;
  });
  const facility = await prisma.facility.findUnique({ where: { id: row.facilityId }, select: { name: true } });
  return serializeSystem({ ...row, facility: { name: facility?.name ?? 'Facility' } });
}

async function lockIdentityMapping(tx: Prisma.TransactionClient, identityId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`interop:identity:${identityId}`}, 0))`;
}

async function lockSourceResource(tx: Prisma.TransactionClient, systemId: string, type: string, resourceId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`interop:resource:${systemId}:${type}:${resourceId}`}, 0))`;
}

async function ensureIdentity(tx: Prisma.TransactionClient, systemId: string, externalPatientId: string) {
  let candidate = await tx.externalPatientIdentity.findUnique({
    where: { externalSystemId_externalPatientId: { externalSystemId: systemId, externalPatientId } },
    select: { id: true },
  });
  if (!candidate) {
    await tx.externalPatientIdentity.createMany({
      data: [{ externalSystemId: systemId, externalPatientId, status: 'unmatched' }],
      skipDuplicates: true,
    });
    candidate = await tx.externalPatientIdentity.findUnique({
      where: { externalSystemId_externalPatientId: { externalSystemId: systemId, externalPatientId } },
      select: { id: true },
    });
  }
  if (!candidate) throw unprocessable('Source patient identity could not be initialized');
  await lockIdentityMapping(tx, candidate.id);
  return tx.externalPatientIdentity.findUniqueOrThrow({
    where: { id: candidate.id },
  });
}

function resourcePatientReference(resource: FhirResource): string | null {
  const field = resource.resourceType === 'AllergyIntolerance' ? resource.patient : resource.subject;
  if (!field) return null;
  return parseReference(field, 'Patient').id;
}

async function validateLinkedReferences(
  tx: Prisma.TransactionClient, systemId: string, identityId: string | null, resource: FhirResource,
) {
  const encounterRef = getObject(resource.encounter);
  if (encounterRef) {
    const ref = parseReference(encounterRef, 'Encounter');
    const encounter = await tx.externalFhirResource.findFirst({
      where: { externalSystemId: systemId, resourceType: 'Encounter', externalResourceId: ref.id, ...(identityId ? { identityId } : {}) },
      select: { id: true },
    });
    if (!encounter) throw unprocessable('FHIR Encounter reference is not available for this source patient');
  }
  if (resource.resourceType === 'Provenance') {
    for (const target of resource.target as unknown[]) {
      const ref = parseReference(target);
      const found = await tx.externalFhirResource.findFirst({
        where: { externalSystemId: systemId, resourceType: ref.type, externalResourceId: ref.id }, select: { id: true },
      });
      if (!found) throw unprocessable('FHIR Provenance target is not available from this source system');
    }
  }
}

export async function importFhirResource(
  system: { id: string; systemKey: string; supportedTypes: string[] },
  input: unknown,
  meta: Meta,
) {
  let resource: FhirResource | null = null;
  try {
    resource = validateFhirResource(input);
    if (!system.supportedTypes.includes(resource.resourceType)) throw unprocessable('FHIR resource type is not enabled for this external system');
    const payloadHash = safeHash(resource);
    const sourceLastUpdated = resource.meta?.lastUpdated ? dateValue(resource.meta.lastUpdated, 'meta.lastUpdated') : null;
    const clinicalEventAt = eventDate(resource.resourceType, resource);
    const externalPatientId = resource.resourceType === 'Patient' ? resource.id : resourcePatientReference(resource);

    return await prisma.$transaction(async (tx) => {
      const identity = externalPatientId ? await ensureIdentity(tx, system.id, externalPatientId) : null;
      // Every patient-scoped import locks the identity mapping before its
      // source resource key. Mapping transitions take only the identity lock,
      // so all association-changing transactions use the same lock order.
      await lockSourceResource(tx, system.id, resource!.resourceType, resource!.id);
      await validateLinkedReferences(tx, system.id, identity?.id ?? null, resource!);

      const versions = await tx.externalFhirResource.findMany({
        where: { externalSystemId: system.id, resourceType: resource!.resourceType, externalResourceId: resource!.id },
        orderBy: { importedAt: 'desc' }, take: 50,
      });
      const sourceVersion = resource!.meta?.versionId ?? null;
      const sameVersion = sourceVersion
        ? versions.find((row) => row.resourceVersion === sourceVersion)
        : versions.find((row) => row.resourceVersion === null && row.payloadHash === payloadHash);
      if (sameVersion) {
        if (sameVersion.payloadHash !== payloadHash) throw conflict('VERSION_CONFLICT', 'FHIR source version was replayed with different content');
        await appendAudit({
          ...auditBase(null, 'interop.import.duplicate', 'external_fhir_resources', sameVersion.id, meta),
          metadata: { externalSystemId: system.id, resourceType: resource!.resourceType, validationStatus: sameVersion.validationStatus },
        }, tx);
        return serializeImport(sameVersion, true);
      }
      const latest = versions.find((row) => row.sourceLastUpdated !== null);
      if (!sourceVersion && versions.some((row) => row.resourceVersion === null && row.payloadHash !== payloadHash && row.sourceLastUpdated?.getTime() === sourceLastUpdated?.getTime())) {
        throw conflict('VERSION_CONFLICT', 'FHIR source update has a conflicting timestamp');
      }
      if (sourceLastUpdated && latest?.sourceLastUpdated && sourceLastUpdated <= latest.sourceLastUpdated) {
        throw conflict('VERSION_CONFLICT', 'FHIR source update is older than the latest accepted version');
      }

      const patientProfileId = identity?.status === 'confirmed' ? identity.patientProfileId : null;
      const isPatientScoped = resource!.resourceType === 'Patient' || clinicalTypes.has(resource!.resourceType);
      const validationStatus = isPatientScoped && !patientProfileId ? 'quarantined' : 'accepted';
      const created = await tx.externalFhirResource.create({
        data: {
          externalSystemId: system.id, identityId: identity?.id ?? null,
          patientProfileId, resourceType: resource!.resourceType, externalResourceId: resource!.id,
          resourceVersion: resource!.meta?.versionId ?? null, sourceLastUpdated, clinicalEventAt,
          validationStatus, resourcePayload: resource as Prisma.InputJsonValue,
          payloadHash, transformationVersion: 'fhir-r4-subset-v1',
        },
      });
      await appendAudit({
        ...auditBase(null, 'interop.import.accepted', 'external_fhir_resources', created.id, meta),
        metadata: {
          externalSystemId: system.id, resourceType: created.resourceType,
          validationStatus: created.validationStatus, payloadHash: created.payloadHash,
        },
      }, tx);
      return serializeImport(created, false);
    }, { maxWait: 10_000, timeout: 15_000 });
  } catch (error) {
    const code = (error as { code?: string })?.code;
    const knownCode = ['VALIDATION_FAILED', 'VERSION_CONFLICT', 'DUPLICATE_RESOURCE'].includes(String(code))
      ? String(code) : 'IMPORT_REJECTED';
    const rawType = getString(getObject(input)?.resourceType);
    const safeType = rawType && supportedTypes.has(rawType) ? rawType : 'unknown';
    await appendAudit({
      ...auditBase(null, 'interop.import.rejected', 'external_health_systems', system.id, meta),
      metadata: { externalSystemId: system.id, resourceType: resource?.resourceType ?? safeType, reasonCode: knownCode },
    }).catch(() => undefined);
    if (error instanceof Error && 'statusCode' in error) throw error;
    throw unprocessable('FHIR import could not be processed');
  }
}

function serializeImport(row: {
  id: string; resourceType: string; externalResourceId: string; resourceVersion: string | null;
  validationStatus: string; payloadHash: string; importedAt: Date; clinicalEventAt: Date | null;
}, duplicate: boolean) {
  return {
    id: row.id, resource_type: row.resourceType, source_resource_id: row.externalResourceId,
    source_version: row.resourceVersion, validation_status: row.validationStatus,
    payload_hash: row.payloadHash, clinical_event_at: row.clinicalEventAt?.toISOString() ?? null,
    imported_at: row.importedAt.toISOString(), duplicate,
  };
}

export async function listPendingIdentities() {
  const rows = await prisma.externalPatientIdentity.findMany({
    where: { status: { in: ['ambiguous', 'unmatched'] } },
    include: { externalSystem: { select: { name: true, systemKey: true } }, _count: { select: { resources: true } } },
    orderBy: { updatedAt: 'asc' }, take: 200,
  });
  return { data: rows.map((row) => ({
    id: row.id, status: row.status,
    source_system: { name: row.externalSystem.name, system_key: row.externalSystem.systemKey },
    imported_resource_count: row._count.resources,
    created_at: row.createdAt.toISOString(), updated_at: row.updatedAt.toISOString(),
    // External identifiers and demographics are intentionally omitted.
  })) };
}

export async function confirmIdentity(
  identityId: string, caller: Caller, input: { patient_profile_id: string; evidence_reference: string }, meta: Meta,
) {
  return prisma.$transaction(async (tx) => {
    await lockIdentityMapping(tx, identityId);
    const identity = await tx.externalPatientIdentity.findUnique({ where: { id: identityId } });
    if (!identity) throw notFound('Identity candidate not found');
    if (identity.status === 'confirmed' && identity.patientProfileId !== input.patient_profile_id) {
      throw conflict('VERSION_CONFLICT', 'A confirmed external identity cannot be reassigned');
    }
    const patient = await tx.patientProfile.findUnique({ where: { id: input.patient_profile_id }, select: { id: true } });
    if (!patient) throw notFound('Patient profile not found');
    const conflictingLink = await tx.externalPatientIdentity.findFirst({
      where: { externalSystemId: identity.externalSystemId, patientProfileId: patient.id, NOT: { id: identity.id } },
      select: { id: true },
    });
    if (conflictingLink) throw conflict('VERSION_CONFLICT', 'This source system already has a different verified identity for the AHP profile');
    const updated = await tx.externalPatientIdentity.update({
      where: { id: identityId }, data: {
        status: 'confirmed', patientProfileId: patient.id, candidateProfileIds: [],
        reviewedByUserId: caller.sub, reviewedAt: new Date(), evidenceReference: input.evidence_reference,
        version: { increment: 1 },
      },
    });
    await tx.externalFhirResource.updateMany({
      where: { identityId, validationStatus: 'quarantined' },
      data: { patientProfileId: patient.id, validationStatus: 'accepted' },
    });
    await appendAudit({
      ...auditBase(caller, 'interop.identity.confirmed', 'external_patient_identities', identityId, meta),
      metadata: { externalSystemId: identity.externalSystemId, patientProfileId: patient.id, evidenceReference: input.evidence_reference },
    }, tx);
    return { id: updated.id, status: updated.status, patient_profile_id: updated.patientProfileId, reviewed_at: updated.reviewedAt?.toISOString() ?? null };
  });
}

export async function markIdentityAmbiguous(
  identityId: string, caller: Caller, input: { candidate_patient_profile_ids: string[]; evidence_reference: string }, meta: Meta,
) {
  if (new Set(input.candidate_patient_profile_ids).size !== input.candidate_patient_profile_ids.length) {
    throw unprocessable('Identity candidates must be distinct');
  }
  return prisma.$transaction(async (tx) => {
    await lockIdentityMapping(tx, identityId);
    const identity = await tx.externalPatientIdentity.findUnique({ where: { id: identityId } });
    if (!identity) throw notFound('Identity candidate not found');
    const candidates = await tx.patientProfile.count({ where: { id: { in: input.candidate_patient_profile_ids } } });
    if (candidates !== input.candidate_patient_profile_ids.length) throw notFound('One or more candidate profiles were not found');
    const updated = await tx.externalPatientIdentity.update({
      where: { id: identityId }, data: {
        status: 'ambiguous', patientProfileId: null,
        candidateProfileIds: input.candidate_patient_profile_ids,
        reviewedByUserId: caller.sub, reviewedAt: new Date(), evidenceReference: input.evidence_reference,
        version: { increment: 1 },
      },
    });
    await tx.externalFhirResource.updateMany({
      where: { identityId },
      data: { patientProfileId: null, validationStatus: 'quarantined' },
    });
    await appendAudit({
      ...auditBase(caller, 'interop.identity.marked_ambiguous', 'external_patient_identities', identityId, meta),
      metadata: { externalSystemId: identity.externalSystemId, candidateCount: input.candidate_patient_profile_ids.length, evidenceReference: input.evidence_reference },
    }, tx);
    return { id: updated.id, status: updated.status, candidate_count: updated.candidateProfileIds.length };
  });
}

export async function rejectIdentity(identityId: string, caller: Caller, input: { evidence_reference: string }, meta: Meta) {
  return prisma.$transaction(async (tx) => {
    await lockIdentityMapping(tx, identityId);
    const identity = await tx.externalPatientIdentity.findUnique({ where: { id: identityId } });
    if (!identity) throw notFound('Identity candidate not found');
    const updated = await tx.externalPatientIdentity.update({
      where: { id: identityId }, data: {
        status: 'rejected', patientProfileId: null, candidateProfileIds: [],
        reviewedByUserId: caller.sub, reviewedAt: new Date(), evidenceReference: input.evidence_reference,
        version: { increment: 1 },
      },
    });
    await tx.externalFhirResource.updateMany({ where: { identityId }, data: { patientProfileId: null, validationStatus: 'quarantined' } });
    await appendAudit({
      ...auditBase(caller, 'interop.identity.rejected', 'external_patient_identities', identityId, meta),
      metadata: { externalSystemId: identity.externalSystemId, evidenceReference: input.evidence_reference },
    }, tx);
    return { id: updated.id, status: updated.status };
  });
}

function codeDisplay(value: unknown): string | null {
  const object = getObject(value);
  if (!object) return getString(value);
  const text = getString(object.text);
  if (text) return text.slice(0, 240);
  const codings = Array.isArray(object.coding) ? object.coding : [];
  for (const coding of codings) {
    const display = getString(getObject(coding)?.display);
    if (display) return display.slice(0, 240);
  }
  return null;
}

function externalCategory(type: string): string | null {
  if (type === 'Encounter') return 'encounter';
  if (type === 'Condition') return 'condition';
  if (type === 'Observation' || type === 'DiagnosticReport') return 'diagnostic';
  if (type === 'MedicationRequest') return 'medication';
  if (type === 'AllergyIntolerance') return 'allergy';
  return null;
}

function externalDetails(type: string, payload: Prisma.JsonValue): JsonObject {
  const resource = getObject(payload) ?? {};
  const details: JsonObject = { resource_type: type, status: getString(resource.status) };
  const code = codeDisplay(resource.code);
  if (code) details.code_display = code;
  if (type === 'Observation') {
    if (resource.valueQuantity !== undefined) details.value_quantity = resource.valueQuantity;
    else if (resource.valueCodeableConcept !== undefined) details.value = codeDisplay(resource.valueCodeableConcept);
    else if (resource.valueString !== undefined) details.value = String(resource.valueString).slice(0, 500);
    if (resource.interpretation !== undefined) details.interpretation = resource.interpretation;
  }
  if (type === 'DiagnosticReport') {
    if (resource.conclusion !== undefined) details.conclusion = String(resource.conclusion).slice(0, 1000);
  }
  if (type === 'MedicationRequest') {
    const medication = codeDisplay(resource.medicationCodeableConcept);
    if (medication) details.medication = medication;
    if (resource.dosageInstruction !== undefined) details.dosage_instruction = resource.dosageInstruction;
  }
  if (type === 'AllergyIntolerance') {
    details.criticality = getString(resource.criticality);
    details.category = resource.category;
  }
  if (type === 'Condition' && resource.onsetDateTime !== undefined) details.onset = resource.onsetDateTime;
  if (type === 'Encounter') details.period = resource.period;
  return details;
}

async function assertTimelineAccess(patientProfileId: string, caller: Caller) {
  const patient = await prisma.patientProfile.findUnique({ where: { id: patientProfileId }, select: { id: true, userId: true, guardianUserId: true } });
  if (!patient) throw notFound('Patient record not found');
  if (caller.role === 'patient') {
    if (patient.userId !== caller.sub && patient.guardianUserId !== caller.sub) {
      throw forbidden('NOT_RESOURCE_OWNER', 'This record is not available to your account');
    }
    return { patient, scopes: new Set(['full_history']), threadIds: new Set<string>() };
  }
  if (caller.role !== 'clinician' || !caller.cpid) throw forbidden('ROLE_NOT_PERMITTED', 'This account cannot view clinical history');
  const clinician = await prisma.clinicianProfile.findFirst({
    where: { id: caller.cpid, userId: caller.sub, verificationStatus: 'verified', user: { status: 'active' } },
    select: { id: true, facilityId: true, facility: { select: { isActive: true } } },
  });
  if (!clinician || !clinician.facilityId || !clinician.facility?.isActive) {
    throw forbidden('CLINICIAN_NOT_VERIFIED', 'An active verified clinician and facility assignment are required');
  }
  const now = new Date();
  const consents = await prisma.patientConsent.findMany({
    where: {
      patientProfileId, allowed: true, breakGlass: false, revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      AND: [{ OR: [
        { granteeType: 'clinician', granteeClinicianId: clinician.id },
        { granteeType: 'facility', granteeFacilityId: clinician.facilityId },
      ] }],
    }, select: { scope: true, careThreadId: true },
  });
  if (!consents.length) {
    await appendAudit({
      actorUserId: caller.sub, action: 'interop.timeline.access_denied', entityType: 'patient_profiles', entityId: patientProfileId,
      metadata: { reason: 'consent_missing' },
    }).catch(() => undefined);
    throw forbidden('PATIENT_CONSENT_REQUIRED', 'Current patient authorization is required to view this history');
  }
  return {
    patient,
    scopes: new Set(consents.map((row) => row.scope)),
    threadIds: new Set(consents.map((row) => row.careThreadId).filter((id): id is string => Boolean(id))),
  };
}

function nativeEntry(input: {
  id: string; category: string; occurredAt: Date; status: string; sourceRecordId: string;
  facilityName?: string | null; summary: string; detail?: JsonObject; careThreadId?: string | null;
}): TimelineEntry {
  return {
    id: input.id, category: input.category, occurred_at: input.occurredAt.toISOString(),
    source: { type: 'ahp', name: 'A-health', facility_name: input.facilityName ?? null, record_id: input.sourceRecordId },
    status: input.status, verification_state: 'ahp_native', summary: input.summary,
    detail: input.detail ?? {}, _care_thread_id: input.careThreadId ?? null,
  };
}

export async function getPatientTimeline(patientProfileId: string, caller: Caller, query: { category?: string; source?: string }, meta: Meta) {
  const access = await assertTimelineAccess(patientProfileId, caller);
  const canFull = access.scopes.has('full_history');
  const [medicalRecords, consultations, referrals, investigations, prescriptions, externalRows] = await Promise.all([
    prisma.medicalRecord.findMany({ where: { patientProfileId }, include: { sourceFacility: { select: { name: true } } } }),
    prisma.consultationRequest.findMany({
      where: { patientProfileId }, include: { assignedClinician: { select: { facility: { select: { name: true } } } }, careThread: { select: { id: true } } },
    }),
    prisma.digitalReferral.findMany({ where: { patientProfileId }, include: { sourceFacility: { select: { name: true } }, consultation: { select: { careThreadId: true } }, outcome: { select: { status: true } } } }),
    prisma.investigationOrder.findMany({ where: { patientProfileId }, include: { facility: { select: { name: true } }, values: true, careThread: { select: { id: true } } } }),
    prisma.prescription.findMany({
      where: { patientProfileId }, include: {
        items: { select: { medicationName: true } },
        prescribedBy: { select: { facility: { select: { name: true } } } },
        dispensingRecords: { include: { pharmacy: { select: { name: true } } } }, careThread: { select: { id: true } },
      },
    }),
    prisma.externalFhirResource.findMany({
      where: {
        patientProfileId, validationStatus: 'accepted', resourceType: { in: [...clinicalTypes] },
        identity: { is: { status: 'confirmed', patientProfileId } },
      },
      include: { externalSystem: { include: { facility: { select: { name: true } } } } },
      orderBy: [{ clinicalEventAt: 'desc' }, { importedAt: 'desc' }], take: 500,
    }),
  ]);

  const entries: TimelineEntry[] = [];
  for (const row of medicalRecords) entries.push(nativeEntry({
    id: row.id, category: row.recordType === 'lab_result' || row.recordType === 'imaging' || row.recordType === 'pathology' ? 'diagnostic' : 'medical_record',
    occurredAt: row.recordedAt, status: row.isCritical ? 'critical_review_required' : 'recorded', sourceRecordId: row.id,
    facilityName: row.sourceFacility?.name, summary: row.title,
    detail: { record_type: row.recordType, body: row.body, structured: row.structured, is_critical: row.isCritical },
    careThreadId: row.careThreadId,
  }));
  for (const row of consultations) entries.push(nativeEntry({
    id: row.id, category: 'consultation', occurredAt: row.completedAt ?? row.createdAt, status: row.status,
    sourceRecordId: row.id, facilityName: row.assignedClinician?.facility?.name,
    summary: `AHP consultation · ${row.status}`, detail: { urgency: row.urgencyLevel, completed_at: row.completedAt?.toISOString() ?? null }, careThreadId: row.careThread.id,
  }));
  for (const row of referrals) entries.push(nativeEntry({
    id: row.id, category: 'referral', occurredAt: row.completedAt ?? row.createdAt, status: row.status,
    sourceRecordId: row.id, facilityName: row.sourceFacility.name,
    summary: `AHP referral · ${row.status}`, detail: { priority: row.priority, outcome: row.outcome?.status ?? null }, careThreadId: row.consultation.careThreadId,
  }));
  for (const row of investigations) entries.push(nativeEntry({
    id: row.id, category: 'diagnostic', occurredAt: row.resultedAt ?? row.orderedAt, status: row.status,
    sourceRecordId: row.id, facilityName: row.facility?.name,
    summary: `AHP diagnostic · ${row.investigationType}`, detail: {
      investigation_code: row.investigationCode, values: row.values.map((value) => ({ analyte: value.analyte, value: value.value, unit: value.unit, flag: value.flag })),
    }, careThreadId: row.careThread.id,
  }));
  for (const row of prescriptions) {
    entries.push(nativeEntry({
      id: row.id, category: 'medication', occurredAt: row.createdAt, status: row.status,
      sourceRecordId: row.id, facilityName: row.prescribedBy.facility?.name,
      summary: `AHP prescription · ${row.items.length} item(s)`, detail: { medications: row.items.map((item) => item.medicationName) }, careThreadId: row.careThread.id,
    }));
    for (const dispense of row.dispensingRecords) entries.push(nativeEntry({
      id: dispense.id, category: 'dispensing', occurredAt: dispense.dispensedAt ?? dispense.createdAt, status: dispense.status,
      sourceRecordId: dispense.id, facilityName: dispense.pharmacy.name,
      summary: `AHP dispensing · ${dispense.status}`, detail: { prescription_id: row.id }, careThreadId: row.careThread.id,
    }));
  }
  for (const row of externalRows) {
    const category = externalCategory(row.resourceType);
    if (!category || !row.clinicalEventAt) continue;
    const payload = getObject(row.resourcePayload) ?? {};
    const code = codeDisplay(payload.code ?? payload.medicationCodeableConcept);
    entries.push({
      id: row.id, category, occurred_at: row.clinicalEventAt.toISOString(),
      source: { type: 'external', name: row.externalSystem.name, facility_name: row.externalSystem.facility.name, record_id: row.externalResourceId },
      status: getString(payload.status) ?? 'imported', verification_state: 'imported_not_clinician_verified',
      summary: code ?? `Imported ${row.resourceType} record`,
      detail: externalDetails(row.resourceType, row.resourcePayload),
      provenance: {
        source_system_id: row.externalSystemId, source_system: row.externalSystem.name,
        source_organization: row.externalSystem.facility.name, source_resource_id: row.externalResourceId,
        source_version: row.resourceVersion, source_last_updated: row.sourceLastUpdated?.toISOString() ?? null,
        imported_at: row.importedAt.toISOString(), validation_state: row.validationStatus,
        transformation_version: row.transformationVersion, payload_hash: row.payloadHash,
      },
      _care_thread_id: null,
    });
  }

  let filtered = entries.filter((entry) => {
    const allowedByMedicationScope = access.scopes.has('medications_only') && ['medication', 'dispensing'].includes(entry.category);
    const allowedByInvestigationScope = access.scopes.has('investigations_only') && entry.category === 'diagnostic';
    const allowedByThreadScope = access.scopes.has('current_thread') && entry.source.type === 'ahp' &&
      Boolean(entry._care_thread_id && access.threadIds.has(entry._care_thread_id));
    if (!canFull && !allowedByMedicationScope && !allowedByInvestigationScope && !allowedByThreadScope) return false;
    if (query.category && entry.category !== query.category) return false;
    if (query.source && entry.source.type !== query.source) return false;
    return true;
  });
  filtered = filtered.sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at));
  const publicEntries = filtered.map(({ _care_thread_id: _thread, ...entry }) => entry);
  await appendAudit({
    actorUserId: caller.sub, action: 'interop.timeline.accessed', entityType: 'patient_profiles', entityId: patientProfileId,
    ipAddress: meta.ip, requestId: meta.requestId,
    metadata: { recordCount: publicEntries.length, sourceKinds: [...new Set(publicEntries.map((entry) => entry.source.type))] },
  });
  return { patient_profile_id: patientProfileId, data: publicEntries };
}

export async function getMyTimeline(caller: Caller, query: { category?: string; source?: string }, meta: Meta) {
  if (caller.role !== 'patient') throw forbidden('ROLE_NOT_PERMITTED', 'Patient account is required');
  const profile = caller.ppid
    ? await prisma.patientProfile.findFirst({ where: { id: caller.ppid, OR: [{ userId: caller.sub }, { guardianUserId: caller.sub }] }, select: { id: true } })
    : await prisma.patientProfile.findFirst({ where: { userId: caller.sub }, select: { id: true } });
  if (!profile) throw forbidden('NOT_RESOURCE_OWNER', 'No patient profile is available to this session');
  return getPatientTimeline(profile.id, caller, query, meta);
}

export async function getExternalRecordDetail(recordId: string, caller: Caller, meta: Meta) {
  const row = await prisma.externalFhirResource.findUnique({
    where: { id: recordId }, include: {
      externalSystem: { include: { facility: { select: { name: true } } } },
      identity: { select: { status: true, patientProfileId: true } },
    },
  });
  if (!row || !row.patientProfileId || row.validationStatus !== 'accepted' ||
      row.identity?.status !== 'confirmed' || row.identity.patientProfileId !== row.patientProfileId) {
    throw notFound('Imported record not found');
  }
  const access = await assertTimelineAccess(row.patientProfileId, caller);
  const category = externalCategory(row.resourceType);
  const detailAllowed = access.scopes.has('full_history') ||
    (category === 'medication' && access.scopes.has('medications_only')) ||
    (category === 'diagnostic' && access.scopes.has('investigations_only'));
  if (!detailAllowed) {
    await appendAudit({
      actorUserId: caller.sub, action: 'interop.record.access_denied', entityType: 'external_fhir_resources', entityId: row.id,
      ipAddress: meta.ip, requestId: meta.requestId, metadata: { reason: 'consent_scope_insufficient' },
    }).catch(() => undefined);
    throw forbidden('PATIENT_CONSENT_REQUIRED', 'Current patient authorization does not cover this record category');
  }
  await appendAudit({
    actorUserId: caller.sub, action: 'interop.record.accessed', entityType: 'external_fhir_resources', entityId: row.id,
    ipAddress: meta.ip, requestId: meta.requestId,
    metadata: { externalSystemId: row.externalSystemId, resourceType: row.resourceType },
  });
  return {
    id: row.id, resource_type: row.resourceType, source_resource_id: row.externalResourceId,
    details: externalDetails(row.resourceType, row.resourcePayload),
    provenance: {
      source_system: row.externalSystem.name, source_organization: row.externalSystem.facility.name,
      source_version: row.resourceVersion, source_last_updated: row.sourceLastUpdated?.toISOString() ?? null,
      clinical_event_at: row.clinicalEventAt?.toISOString() ?? null, imported_at: row.importedAt.toISOString(),
      validation_state: row.validationStatus, transformation_version: row.transformationVersion, payload_hash: row.payloadHash,
    },
  };
}

export function validateIntegrationProfile(resource: unknown) {
  return validateFhirResource(resource);
}
