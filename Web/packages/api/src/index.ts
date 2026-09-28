export type { paths, components, operations } from './generated/schema';

export type Schemas = import('./generated/schema').components['schemas'];

export type CareThread = Schemas['CareThread'];
export type ConsultationRequest = Schemas['ConsultationRequest'];
export type Appointment = Schemas['Appointment'];
export type Message = Schemas['Message'];
export type CheckIn = Schemas['CheckIn'];
export type Prescription = Schemas['Prescription'];
export type AdherenceLog = Schemas['AdherenceLog'];
export type ErrorEnvelope = Schemas['ErrorEnvelope'];
export type ErrorCode = Schemas['ErrorCode'];

export const OPENAPI_PATH = 'openapi/a-health-api-v1.yaml';
