import type { CdmRow } from './sql.js';
import type { Cell, CodeMapping } from '../portal/types.js';
export interface WarehouseConfig { enabled:boolean; databaseUrl:string; expectedDatabase:string; maxRows:number; workerEnabled:boolean }
export interface Concept { concept_id:number; concept_name:string; domain_id:string; vocabulary_id:string; concept_class_id:string; standard_concept:string|null; concept_code:string; valid_start_date:string; valid_end_date:string; invalid_reason:string|null }
export interface Vocabulary {
  id:string;version:string;schema:string;synthetic:boolean;hash:string;concepts:Map<number,Concept>;
  ancestors:Array<{ancestor_concept_id:number;descendant_concept_id:number}>;
  domains:Map<number,string>;
}
export interface CdmBundle { cdm_version:'5.4'; tables:Record<string,CdmRow[]> }
export interface QualityIssue { check:string;table:string;column?:string;count:number;severity:'error'|'warning' }
export interface QualityReport { version:string; passed:boolean; checks_executed:string[]; issues:QualityIssue[]; table_counts:Record<string,number>; ohdsi_dqd_run:false }
export interface Materialized {
  schema:string;vocabularyId:string;vocabularyVersion:string;sourceHash:string;manifestHash:string;
  quality:QualityReport;cells:Cell[];withheld:number;persons:number;createdAt:string;
}
export interface BuildInput {
  buildId:string;sourceId:string;datasetId:string;synthetic:boolean;bundles:CdmBundle[];mappings:CodeMapping[];
  sourceHash:string;minimumCellSize:number;linkageKey:Buffer;datePolicy:'restricted_source_dates'|'shifted_dates';
}
export interface WarehousePort {
  status():Promise<{enabled:boolean;ready:boolean;cdm_version:string;table_count:number;vocabulary_version:string|null;synthetic:boolean|null}>;
  materialize(input:BuildInput):Promise<Materialized>;
  extract(schema:string,expectedHash:string):Promise<{tables:Record<string,CdmRow[]>;manifest:Record<string,unknown>}>;
}
export type IdMap=Map<string,number>;
