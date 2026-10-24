/** Domain boundary: private staging rows are never returned through a researcher response. */
export interface Actor { sub: string; role: string }
export interface BaseRow { id: string; version: number; createdAt: Date; updatedAt: Date }
export interface Application extends BaseRow {
  userId: string; kind: 'independent'|'institutional'; displayName: string; institution: string|null;
  credentialReference: string; status: string; reviewedBy: string|null; reviewNote: string|null;
}
export interface Study extends BaseRow {
  ownerId: string; title: string; purpose: string; datasetId: string; releaseId: string|null; status: string;
  ethicsReference: string; ethicsExpiresAt: Date; controllerReference: string; expiresAt: Date;
  allowExport: boolean; allowEcrf: boolean; allowRowLevel?:boolean; reviewedBy: string|null; reviewNote: string|null;
}
export interface Evidence extends BaseRow {
  ownerId: string; studyId: string|null; sourceId: string|null; kind: string;
  sha256: string; sizeBytes: number; scanStatus: string; ciphertext: string;
}
export interface Collection extends BaseRow {
  name: string; description: string; domains: string[]; minimumCellSize: number; status: string;
  syntheticOnly: boolean; latestReleaseId: string|null; createdBy: string;
}
export interface SourceGrant extends BaseRow {
  datasetId: string; facilityId: string; stewardId: string; agreementReference: string; expiresAt: Date;
  status: string; createdBy: string; reviewedBy: string|null;
}
export interface StagedEvent extends BaseRow { datasetId: string; sourceId: string; eventHash: string; payloadHash: string; ciphertext: string }
export interface Cell {
  age_band: string; sex: string; region: string; period: string; domain: string; code_system: string;
  code: string; label: string; participants: number;
}
export interface Quality { staged_events: number; unmapped_events: number; mapping_coverage: number; withheld_cells: number; transform_version: string; warehouse_build_id?:string }
export interface Release extends BaseRow {
  datasetId: string; status: string; sourceIds: string[]; cells: Cell[]; quality: Quality;
  minimumCellSize: number; contentHash: string; createdBy: string; reviewedBy: string|null; reviewNote: string|null;
}
export type Filters = Partial<Record<'age_band'|'sex'|'region'|'period'|'domain'|'code', string>>;
export interface ExportRequest extends BaseRow {
  studyId: string; ownerId: string; releaseId: string; format: string; filters: Filters; status: string; reviewedBy: string|null; expiresAt: Date;
}
export interface FormField { key: string; label: string; type: 'number'|'choice'|'boolean'; required: boolean; min?: number; max?: number; choices?: string[] }
export interface Form extends BaseRow { studyId: string; ownerId: string; title: string; fields: FormField[]; status: string; reviewedBy: string|null }
export interface FormResponse extends BaseRow { formId: string; subjectHash: string; ciphertext: string; submittedBy: string; consentReferenceHash: string; status?:string;withdrawnAt?:Date|null;withdrawalCode?:string|null }
export interface AccessKey extends BaseRow { studyId: string; ownerId: string; tokenHash: string; status: string; expiresAt: Date }
export interface CodeMapping extends BaseRow { system: string; sourceCode: string; domain: string; conceptId: number; standardConcept: boolean; vocabularyVersion: string; label: string; createdBy: string }
export interface Throttle extends BaseRow { actorKey: string; windowStart: Date; hits: number }
export interface Rows {
  application: Application; study: Study; evidence: Evidence; collection: Collection; source: SourceGrant;
  event: StagedEvent; release: Release; export: ExportRequest; form: Form; response: FormResponse; key: AccessKey;
  mapping: CodeMapping; throttle: Throttle; omopBatch:OmopBatch;omopBuild:OmopBuild;responseSnapshot:ResponseSnapshot;output:OutputRequest;
}
export type Table = keyof Rows;
export interface AuditEvent { actorUserId: string; action: string; entityType: string; entityId?: string; metadata?: Record<string, string|number|boolean|null> }
export interface Tx {
  get<K extends Table>(table: K, id: string): Promise<Rows[K]|null>;
  list<K extends Table>(table: K, filter?: Partial<Rows[K]>, limit?: number): Promise<Rows[K][]>;
  insert<K extends Table>(table: K, row: Rows[K]): Promise<Rows[K]>;
  patch<K extends Table>(table: K, id: string, fields: Partial<Rows[K]>): Promise<Rows[K]>;
  user(id: string): Promise<{id: string; role: string; status: string}|null>;
  facility(id: string): Promise<{id: string; isActive: boolean}|null>;
  audit(event: AuditEvent): Promise<void>;
}
export interface Store { transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> }
export interface PortalConfig { enabled: boolean; realDataEnabled: boolean; encryptionKey: Buffer; linkageKey: Buffer }
export interface SafeEvent {
  subject_hash: string; age_band: string; sex: string; region: string; period: string;
  domain: string; code_system: string; code: string; value: number|null; unit: string|null;
  dose: number|null; duration_days: number|null; concept_id: number; mapping_version: string|null;
}

export interface OmopBatch extends BaseRow { datasetId:string;sourceId:string;requestKey:string;payloadHash:string;ciphertext:string;inputRows:number;synthetic:boolean;submittedBy:string;status:string }
export interface OmopBuild extends BaseRow { datasetId:string;sourceId:string;ownerId:string;batchIds:string[];sourceFingerprint:string;datePolicy:'restricted_source_dates'|'shifted_dates';status:string;warehouseSchema:string|null;vocabularyVersion:string|null;manifestHash:string|null;quality:Record<string,unknown>;cells:Cell[];withheldCells:number;personCount:number;releaseId:string|null;errorCode:string|null;leaseToken:string|null;leaseExpiresAt:Date|null;reviewedBy:string|null;reviewNote:string|null }
export interface ResponseSnapshot extends BaseRow { formId:string;studyId:string;ownerId:string;formVersion:number;responseFingerprint:string;specHash:string;bins:Record<string,number[]>;cells:import('../responses/analytics.js').ResponseCell[];suppressedFields:string[];responseCount:number;minimumCellSize:number;ciphertext:string;contentHash:string;status:string;reviewedBy:string|null;reviewNote:string|null }
export interface OutputRequest extends BaseRow {studyId:string;ownerId:string;kind:'ecrf_aggregate'|'ecrf_rows'|'omop';snapshotId:string|null;buildId:string|null;format:string;status:string;reviewedBy:string|null;reviewNote:string|null;expiresAt:Date}
