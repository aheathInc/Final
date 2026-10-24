-- AHP OMOP CDM 5.4 schema. Substitute only a validated schema name for @cdmDatabaseSchema.

-- Explicit provisioning only; never execute on the operational/public schema.

CREATE TABLE @cdmDatabaseSchema."person" (
  "person_id" INTEGER NOT NULL,
  "gender_concept_id" INTEGER NOT NULL,
  "year_of_birth" INTEGER NOT NULL,
  "month_of_birth" INTEGER,
  "day_of_birth" INTEGER,
  "birth_datetime" TIMESTAMP,
  "race_concept_id" INTEGER NOT NULL,
  "ethnicity_concept_id" INTEGER NOT NULL,
  "location_id" INTEGER,
  "provider_id" INTEGER,
  "care_site_id" INTEGER,
  "person_source_value" VARCHAR(50),
  "gender_source_value" VARCHAR(50),
  "gender_source_concept_id" INTEGER,
  "race_source_value" VARCHAR(50),
  "race_source_concept_id" INTEGER,
  "ethnicity_source_value" VARCHAR(50),
  "ethnicity_source_concept_id" INTEGER
);

CREATE TABLE @cdmDatabaseSchema."observation_period" (
  "observation_period_id" INTEGER NOT NULL,
  "person_id" INTEGER NOT NULL,
  "observation_period_start_date" DATE NOT NULL,
  "observation_period_end_date" DATE NOT NULL,
  "period_type_concept_id" INTEGER NOT NULL
);

CREATE TABLE @cdmDatabaseSchema."visit_occurrence" (
  "visit_occurrence_id" INTEGER NOT NULL,
  "person_id" INTEGER NOT NULL,
  "visit_concept_id" INTEGER NOT NULL,
  "visit_start_date" DATE NOT NULL,
  "visit_start_datetime" TIMESTAMP,
  "visit_end_date" DATE NOT NULL,
  "visit_end_datetime" TIMESTAMP,
  "visit_type_concept_id" INTEGER NOT NULL,
  "provider_id" INTEGER,
  "care_site_id" INTEGER,
  "visit_source_value" VARCHAR(50),
  "visit_source_concept_id" INTEGER,
  "admitted_from_concept_id" INTEGER,
  "admitted_from_source_value" VARCHAR(50),
  "discharged_to_concept_id" INTEGER,
  "discharged_to_source_value" VARCHAR(50),
  "preceding_visit_occurrence_id" INTEGER
);

CREATE TABLE @cdmDatabaseSchema."visit_detail" (
  "visit_detail_id" INTEGER NOT NULL,
  "person_id" INTEGER NOT NULL,
  "visit_detail_concept_id" INTEGER NOT NULL,
  "visit_detail_start_date" DATE NOT NULL,
  "visit_detail_start_datetime" TIMESTAMP,
  "visit_detail_end_date" DATE NOT NULL,
  "visit_detail_end_datetime" TIMESTAMP,
  "visit_detail_type_concept_id" INTEGER NOT NULL,
  "provider_id" INTEGER,
  "care_site_id" INTEGER,
  "visit_detail_source_value" VARCHAR(50),
  "visit_detail_source_concept_id" INTEGER,
  "admitted_from_concept_id" INTEGER,
  "admitted_from_source_value" VARCHAR(50),
  "discharged_to_source_value" VARCHAR(50),
  "discharged_to_concept_id" INTEGER,
  "preceding_visit_detail_id" INTEGER,
  "parent_visit_detail_id" INTEGER,
  "visit_occurrence_id" INTEGER NOT NULL
);

CREATE TABLE @cdmDatabaseSchema."condition_occurrence" (
  "condition_occurrence_id" INTEGER NOT NULL,
  "person_id" INTEGER NOT NULL,
  "condition_concept_id" INTEGER NOT NULL,
  "condition_start_date" DATE NOT NULL,
  "condition_start_datetime" TIMESTAMP,
  "condition_end_date" DATE,
  "condition_end_datetime" TIMESTAMP,
  "condition_type_concept_id" INTEGER NOT NULL,
  "condition_status_concept_id" INTEGER,
  "stop_reason" VARCHAR(20),
  "provider_id" INTEGER,
  "visit_occurrence_id" INTEGER,
  "visit_detail_id" INTEGER,
  "condition_source_value" VARCHAR(50),
  "condition_source_concept_id" INTEGER,
  "condition_status_source_value" VARCHAR(50)
);

CREATE TABLE @cdmDatabaseSchema."drug_exposure" (
  "drug_exposure_id" INTEGER NOT NULL,
  "person_id" INTEGER NOT NULL,
  "drug_concept_id" INTEGER NOT NULL,
  "drug_exposure_start_date" DATE NOT NULL,
  "drug_exposure_start_datetime" TIMESTAMP,
  "drug_exposure_end_date" DATE NOT NULL,
  "drug_exposure_end_datetime" TIMESTAMP,
  "verbatim_end_date" DATE,
  "drug_type_concept_id" INTEGER NOT NULL,
  "stop_reason" VARCHAR(20),
  "refills" INTEGER,
  "quantity" NUMERIC,
  "days_supply" INTEGER,
  "sig" TEXT,
  "route_concept_id" INTEGER,
  "lot_number" VARCHAR(50),
  "provider_id" INTEGER,
  "visit_occurrence_id" INTEGER,
  "visit_detail_id" INTEGER,
  "drug_source_value" VARCHAR(50),
  "drug_source_concept_id" INTEGER,
  "route_source_value" VARCHAR(50),
  "dose_unit_source_value" VARCHAR(50)
);

CREATE TABLE @cdmDatabaseSchema."procedure_occurrence" (
  "procedure_occurrence_id" INTEGER NOT NULL,
  "person_id" INTEGER NOT NULL,
  "procedure_concept_id" INTEGER NOT NULL,
  "procedure_date" DATE NOT NULL,
  "procedure_datetime" TIMESTAMP,
  "procedure_end_date" DATE,
  "procedure_end_datetime" TIMESTAMP,
  "procedure_type_concept_id" INTEGER NOT NULL,
  "modifier_concept_id" INTEGER,
  "quantity" INTEGER,
  "provider_id" INTEGER,
  "visit_occurrence_id" INTEGER,
  "visit_detail_id" INTEGER,
  "procedure_source_value" VARCHAR(50),
  "procedure_source_concept_id" INTEGER,
  "modifier_source_value" VARCHAR(50)
);

CREATE TABLE @cdmDatabaseSchema."device_exposure" (
  "device_exposure_id" INTEGER NOT NULL,
  "person_id" INTEGER NOT NULL,
  "device_concept_id" INTEGER NOT NULL,
  "device_exposure_start_date" DATE NOT NULL,
  "device_exposure_start_datetime" TIMESTAMP,
  "device_exposure_end_date" DATE,
  "device_exposure_end_datetime" TIMESTAMP,
  "device_type_concept_id" INTEGER NOT NULL,
  "unique_device_id" VARCHAR(255),
  "production_id" VARCHAR(255),
  "quantity" INTEGER,
  "provider_id" INTEGER,
  "visit_occurrence_id" INTEGER,
  "visit_detail_id" INTEGER,
  "device_source_value" VARCHAR(50),
  "device_source_concept_id" INTEGER,
  "unit_concept_id" INTEGER,
  "unit_source_value" VARCHAR(50),
  "unit_source_concept_id" INTEGER
);

CREATE TABLE @cdmDatabaseSchema."measurement" (
  "measurement_id" INTEGER NOT NULL,
  "person_id" INTEGER NOT NULL,
  "measurement_concept_id" INTEGER NOT NULL,
  "measurement_date" DATE NOT NULL,
  "measurement_datetime" TIMESTAMP,
  "measurement_time" VARCHAR(10),
  "measurement_type_concept_id" INTEGER NOT NULL,
  "operator_concept_id" INTEGER,
  "value_as_number" NUMERIC,
  "value_as_concept_id" INTEGER,
  "unit_concept_id" INTEGER,
  "range_low" NUMERIC,
  "range_high" NUMERIC,
  "provider_id" INTEGER,
  "visit_occurrence_id" INTEGER,
  "visit_detail_id" INTEGER,
  "measurement_source_value" VARCHAR(50),
  "measurement_source_concept_id" INTEGER,
  "unit_source_value" VARCHAR(50),
  "unit_source_concept_id" INTEGER,
  "value_source_value" VARCHAR(50),
  "measurement_event_id" INTEGER,
  "meas_event_field_concept_id" INTEGER
);

CREATE TABLE @cdmDatabaseSchema."observation" (
  "observation_id" INTEGER NOT NULL,
  "person_id" INTEGER NOT NULL,
  "observation_concept_id" INTEGER NOT NULL,
  "observation_date" DATE NOT NULL,
  "observation_datetime" TIMESTAMP,
  "observation_type_concept_id" INTEGER NOT NULL,
  "value_as_number" NUMERIC,
  "value_as_string" VARCHAR(60),
  "value_as_concept_id" INTEGER,
  "qualifier_concept_id" INTEGER,
  "unit_concept_id" INTEGER,
  "provider_id" INTEGER,
  "visit_occurrence_id" INTEGER,
  "visit_detail_id" INTEGER,
  "observation_source_value" VARCHAR(50),
  "observation_source_concept_id" INTEGER,
  "unit_source_value" VARCHAR(50),
  "qualifier_source_value" VARCHAR(50),
  "value_source_value" VARCHAR(50),
  "observation_event_id" INTEGER,
  "obs_event_field_concept_id" INTEGER
);

CREATE TABLE @cdmDatabaseSchema."death" (
  "person_id" INTEGER NOT NULL,
  "death_date" DATE NOT NULL,
  "death_datetime" TIMESTAMP,
  "death_type_concept_id" INTEGER,
  "cause_concept_id" INTEGER,
  "cause_source_value" VARCHAR(50),
  "cause_source_concept_id" INTEGER
);

CREATE TABLE @cdmDatabaseSchema."note" (
  "note_id" INTEGER NOT NULL,
  "person_id" INTEGER NOT NULL,
  "note_date" DATE NOT NULL,
  "note_datetime" TIMESTAMP,
  "note_type_concept_id" INTEGER NOT NULL,
  "note_class_concept_id" INTEGER NOT NULL,
  "note_title" VARCHAR(250),
  "note_text" TEXT NOT NULL,
  "encoding_concept_id" INTEGER NOT NULL,
  "language_concept_id" INTEGER NOT NULL,
  "provider_id" INTEGER,
  "visit_occurrence_id" INTEGER,
  "visit_detail_id" INTEGER,
  "note_source_value" VARCHAR(50),
  "note_event_id" INTEGER,
  "note_event_field_concept_id" INTEGER
);

CREATE TABLE @cdmDatabaseSchema."note_nlp" (
  "note_nlp_id" INTEGER NOT NULL,
  "note_id" INTEGER NOT NULL,
  "section_concept_id" INTEGER,
  "snippet" VARCHAR(250),
  "offset" VARCHAR(50),
  "lexical_variant" VARCHAR(250) NOT NULL,
  "note_nlp_concept_id" INTEGER,
  "note_nlp_source_concept_id" INTEGER,
  "nlp_system" VARCHAR(250),
  "nlp_date" DATE NOT NULL,
  "nlp_datetime" TIMESTAMP,
  "term_exists" VARCHAR(1),
  "term_temporal" VARCHAR(50),
  "term_modifiers" VARCHAR(2000)
);

CREATE TABLE @cdmDatabaseSchema."specimen" (
  "specimen_id" INTEGER NOT NULL,
  "person_id" INTEGER NOT NULL,
  "specimen_concept_id" INTEGER NOT NULL,
  "specimen_type_concept_id" INTEGER NOT NULL,
  "specimen_date" DATE NOT NULL,
  "specimen_datetime" TIMESTAMP,
  "quantity" NUMERIC,
  "unit_concept_id" INTEGER,
  "anatomic_site_concept_id" INTEGER,
  "disease_status_concept_id" INTEGER,
  "specimen_source_id" VARCHAR(50),
  "specimen_source_value" VARCHAR(50),
  "unit_source_value" VARCHAR(50),
  "anatomic_site_source_value" VARCHAR(50),
  "disease_status_source_value" VARCHAR(50)
);

CREATE TABLE @cdmDatabaseSchema."fact_relationship" (
  "domain_concept_id_1" INTEGER NOT NULL,
  "fact_id_1" INTEGER NOT NULL,
  "domain_concept_id_2" INTEGER NOT NULL,
  "fact_id_2" INTEGER NOT NULL,
  "relationship_concept_id" INTEGER NOT NULL
);

CREATE TABLE @cdmDatabaseSchema."location" (
  "location_id" INTEGER NOT NULL,
  "address_1" VARCHAR(50),
  "address_2" VARCHAR(50),
  "city" VARCHAR(50),
  "state" VARCHAR(2),
  "zip" VARCHAR(9),
  "county" VARCHAR(20),
  "location_source_value" VARCHAR(50),
  "country_concept_id" INTEGER,
  "country_source_value" VARCHAR(80),
  "latitude" NUMERIC,
  "longitude" NUMERIC
);

CREATE TABLE @cdmDatabaseSchema."care_site" (
  "care_site_id" INTEGER NOT NULL,
  "care_site_name" VARCHAR(255),
  "place_of_service_concept_id" INTEGER,
  "location_id" INTEGER,
  "care_site_source_value" VARCHAR(50),
  "place_of_service_source_value" VARCHAR(50)
);

CREATE TABLE @cdmDatabaseSchema."provider" (
  "provider_id" INTEGER NOT NULL,
  "provider_name" VARCHAR(255),
  "npi" VARCHAR(20),
  "dea" VARCHAR(20),
  "specialty_concept_id" INTEGER,
  "care_site_id" INTEGER,
  "year_of_birth" INTEGER,
  "gender_concept_id" INTEGER,
  "provider_source_value" VARCHAR(50),
  "specialty_source_value" VARCHAR(50),
  "specialty_source_concept_id" INTEGER,
  "gender_source_value" VARCHAR(50),
  "gender_source_concept_id" INTEGER
);

CREATE TABLE @cdmDatabaseSchema."payer_plan_period" (
  "payer_plan_period_id" INTEGER NOT NULL,
  "person_id" INTEGER NOT NULL,
  "payer_plan_period_start_date" DATE NOT NULL,
  "payer_plan_period_end_date" DATE NOT NULL,
  "payer_concept_id" INTEGER,
  "payer_source_value" VARCHAR(50),
  "payer_source_concept_id" INTEGER,
  "plan_concept_id" INTEGER,
  "plan_source_value" VARCHAR(50),
  "plan_source_concept_id" INTEGER,
  "sponsor_concept_id" INTEGER,
  "sponsor_source_value" VARCHAR(50),
  "sponsor_source_concept_id" INTEGER,
  "family_source_value" VARCHAR(50),
  "stop_reason_concept_id" INTEGER,
  "stop_reason_source_value" VARCHAR(50),
  "stop_reason_source_concept_id" INTEGER
);

CREATE TABLE @cdmDatabaseSchema."cost" (
  "cost_id" INTEGER NOT NULL,
  "cost_event_id" INTEGER NOT NULL,
  "cost_domain_id" VARCHAR(20) NOT NULL,
  "cost_type_concept_id" INTEGER NOT NULL,
  "currency_concept_id" INTEGER,
  "total_charge" NUMERIC,
  "total_cost" NUMERIC,
  "total_paid" NUMERIC,
  "paid_by_payer" NUMERIC,
  "paid_by_patient" NUMERIC,
  "paid_patient_copay" NUMERIC,
  "paid_patient_coinsurance" NUMERIC,
  "paid_patient_deductible" NUMERIC,
  "paid_by_primary" NUMERIC,
  "paid_ingredient_cost" NUMERIC,
  "paid_dispensing_fee" NUMERIC,
  "payer_plan_period_id" INTEGER,
  "amount_allowed" NUMERIC,
  "revenue_code_concept_id" INTEGER,
  "revenue_code_source_value" VARCHAR(50),
  "drg_concept_id" INTEGER,
  "drg_source_value" VARCHAR(3)
);

CREATE TABLE @cdmDatabaseSchema."drug_era" (
  "drug_era_id" INTEGER NOT NULL,
  "person_id" INTEGER NOT NULL,
  "drug_concept_id" INTEGER NOT NULL,
  "drug_era_start_date" DATE NOT NULL,
  "drug_era_end_date" DATE NOT NULL,
  "drug_exposure_count" INTEGER,
  "gap_days" INTEGER
);

CREATE TABLE @cdmDatabaseSchema."dose_era" (
  "dose_era_id" INTEGER NOT NULL,
  "person_id" INTEGER NOT NULL,
  "drug_concept_id" INTEGER NOT NULL,
  "unit_concept_id" INTEGER NOT NULL,
  "dose_value" NUMERIC NOT NULL,
  "dose_era_start_date" DATE NOT NULL,
  "dose_era_end_date" DATE NOT NULL
);

CREATE TABLE @cdmDatabaseSchema."condition_era" (
  "condition_era_id" INTEGER NOT NULL,
  "person_id" INTEGER NOT NULL,
  "condition_concept_id" INTEGER NOT NULL,
  "condition_era_start_date" DATE NOT NULL,
  "condition_era_end_date" DATE NOT NULL,
  "condition_occurrence_count" INTEGER
);

CREATE TABLE @cdmDatabaseSchema."episode" (
  "episode_id" INTEGER NOT NULL,
  "person_id" INTEGER NOT NULL,
  "episode_concept_id" INTEGER NOT NULL,
  "episode_start_date" DATE NOT NULL,
  "episode_start_datetime" TIMESTAMP,
  "episode_end_date" DATE,
  "episode_end_datetime" TIMESTAMP,
  "episode_parent_id" INTEGER,
  "episode_number" INTEGER,
  "episode_object_concept_id" INTEGER NOT NULL,
  "episode_type_concept_id" INTEGER NOT NULL,
  "episode_source_value" VARCHAR(50),
  "episode_source_concept_id" INTEGER
);

CREATE TABLE @cdmDatabaseSchema."episode_event" (
  "episode_id" INTEGER NOT NULL,
  "event_id" INTEGER NOT NULL,
  "episode_event_field_concept_id" INTEGER NOT NULL
);

CREATE TABLE @cdmDatabaseSchema."metadata" (
  "metadata_id" INTEGER NOT NULL,
  "metadata_concept_id" INTEGER NOT NULL,
  "metadata_type_concept_id" INTEGER NOT NULL,
  "name" VARCHAR(250) NOT NULL,
  "value_as_string" VARCHAR(250),
  "value_as_concept_id" INTEGER,
  "value_as_number" NUMERIC,
  "metadata_date" DATE,
  "metadata_datetime" TIMESTAMP
);

CREATE TABLE @cdmDatabaseSchema."cdm_source" (
  "cdm_source_name" VARCHAR(255) NOT NULL,
  "cdm_source_abbreviation" VARCHAR(25) NOT NULL,
  "cdm_holder" VARCHAR(255) NOT NULL,
  "source_description" TEXT,
  "source_documentation_reference" VARCHAR(255),
  "cdm_etl_reference" VARCHAR(255),
  "source_release_date" DATE NOT NULL,
  "cdm_release_date" DATE NOT NULL,
  "cdm_version" VARCHAR(10),
  "cdm_version_concept_id" INTEGER NOT NULL,
  "vocabulary_version" VARCHAR(20) NOT NULL
);

CREATE TABLE @cdmDatabaseSchema."concept" (
  "concept_id" INTEGER NOT NULL,
  "concept_name" VARCHAR(255) NOT NULL,
  "domain_id" VARCHAR(20) NOT NULL,
  "vocabulary_id" VARCHAR(20) NOT NULL,
  "concept_class_id" VARCHAR(20) NOT NULL,
  "standard_concept" VARCHAR(1),
  "concept_code" VARCHAR(50) NOT NULL,
  "valid_start_date" DATE NOT NULL,
  "valid_end_date" DATE NOT NULL,
  "invalid_reason" VARCHAR(1)
);

CREATE TABLE @cdmDatabaseSchema."vocabulary" (
  "vocabulary_id" VARCHAR(20) NOT NULL,
  "vocabulary_name" VARCHAR(255) NOT NULL,
  "vocabulary_reference" VARCHAR(255),
  "vocabulary_version" VARCHAR(255),
  "vocabulary_concept_id" INTEGER NOT NULL
);

CREATE TABLE @cdmDatabaseSchema."domain" (
  "domain_id" VARCHAR(20) NOT NULL,
  "domain_name" VARCHAR(255) NOT NULL,
  "domain_concept_id" INTEGER NOT NULL
);

CREATE TABLE @cdmDatabaseSchema."concept_class" (
  "concept_class_id" VARCHAR(20) NOT NULL,
  "concept_class_name" VARCHAR(255) NOT NULL,
  "concept_class_concept_id" INTEGER NOT NULL
);

CREATE TABLE @cdmDatabaseSchema."concept_relationship" (
  "concept_id_1" INTEGER NOT NULL,
  "concept_id_2" INTEGER NOT NULL,
  "relationship_id" VARCHAR(20) NOT NULL,
  "valid_start_date" DATE NOT NULL,
  "valid_end_date" DATE NOT NULL,
  "invalid_reason" VARCHAR(1)
);

CREATE TABLE @cdmDatabaseSchema."relationship" (
  "relationship_id" VARCHAR(20) NOT NULL,
  "relationship_name" VARCHAR(255) NOT NULL,
  "is_hierarchical" VARCHAR(1) NOT NULL,
  "defines_ancestry" VARCHAR(1) NOT NULL,
  "reverse_relationship_id" VARCHAR(20) NOT NULL,
  "relationship_concept_id" INTEGER NOT NULL
);

CREATE TABLE @cdmDatabaseSchema."concept_synonym" (
  "concept_id" INTEGER NOT NULL,
  "concept_synonym_name" VARCHAR(1000) NOT NULL,
  "language_concept_id" INTEGER NOT NULL
);

CREATE TABLE @cdmDatabaseSchema."concept_ancestor" (
  "ancestor_concept_id" INTEGER NOT NULL,
  "descendant_concept_id" INTEGER NOT NULL,
  "min_levels_of_separation" INTEGER NOT NULL,
  "max_levels_of_separation" INTEGER NOT NULL
);

CREATE TABLE @cdmDatabaseSchema."source_to_concept_map" (
  "source_code" VARCHAR(50) NOT NULL,
  "source_concept_id" INTEGER NOT NULL,
  "source_vocabulary_id" VARCHAR(20) NOT NULL,
  "source_code_description" VARCHAR(255),
  "target_concept_id" INTEGER NOT NULL,
  "target_vocabulary_id" VARCHAR(20) NOT NULL,
  "valid_start_date" DATE NOT NULL,
  "valid_end_date" DATE NOT NULL,
  "invalid_reason" VARCHAR(1)
);

CREATE TABLE @cdmDatabaseSchema."drug_strength" (
  "drug_concept_id" INTEGER NOT NULL,
  "ingredient_concept_id" INTEGER NOT NULL,
  "amount_value" NUMERIC,
  "amount_unit_concept_id" INTEGER,
  "numerator_value" NUMERIC,
  "numerator_unit_concept_id" INTEGER,
  "denominator_value" NUMERIC,
  "denominator_unit_concept_id" INTEGER,
  "box_size" INTEGER,
  "valid_start_date" DATE NOT NULL,
  "valid_end_date" DATE NOT NULL,
  "invalid_reason" VARCHAR(1)
);

CREATE TABLE @cdmDatabaseSchema."cohort" (
  "cohort_definition_id" INTEGER NOT NULL,
  "subject_id" INTEGER NOT NULL,
  "cohort_start_date" DATE NOT NULL,
  "cohort_end_date" DATE NOT NULL
);

CREATE TABLE @cdmDatabaseSchema."cohort_definition" (
  "cohort_definition_id" INTEGER NOT NULL,
  "cohort_definition_name" VARCHAR(255) NOT NULL,
  "cohort_definition_description" TEXT,
  "definition_type_concept_id" INTEGER NOT NULL,
  "cohort_definition_syntax" TEXT,
  "subject_concept_id" INTEGER NOT NULL,
  "cohort_initiation_date" DATE
);

ALTER TABLE @cdmDatabaseSchema."person" ADD PRIMARY KEY ("person_id");

ALTER TABLE @cdmDatabaseSchema."observation_period" ADD PRIMARY KEY ("observation_period_id");

ALTER TABLE @cdmDatabaseSchema."visit_occurrence" ADD PRIMARY KEY ("visit_occurrence_id");

ALTER TABLE @cdmDatabaseSchema."visit_detail" ADD PRIMARY KEY ("visit_detail_id");

ALTER TABLE @cdmDatabaseSchema."condition_occurrence" ADD PRIMARY KEY ("condition_occurrence_id");

ALTER TABLE @cdmDatabaseSchema."drug_exposure" ADD PRIMARY KEY ("drug_exposure_id");

ALTER TABLE @cdmDatabaseSchema."procedure_occurrence" ADD PRIMARY KEY ("procedure_occurrence_id");

ALTER TABLE @cdmDatabaseSchema."device_exposure" ADD PRIMARY KEY ("device_exposure_id");

ALTER TABLE @cdmDatabaseSchema."measurement" ADD PRIMARY KEY ("measurement_id");

ALTER TABLE @cdmDatabaseSchema."observation" ADD PRIMARY KEY ("observation_id");

ALTER TABLE @cdmDatabaseSchema."note" ADD PRIMARY KEY ("note_id");

ALTER TABLE @cdmDatabaseSchema."note_nlp" ADD PRIMARY KEY ("note_nlp_id");

ALTER TABLE @cdmDatabaseSchema."specimen" ADD PRIMARY KEY ("specimen_id");

ALTER TABLE @cdmDatabaseSchema."location" ADD PRIMARY KEY ("location_id");

ALTER TABLE @cdmDatabaseSchema."care_site" ADD PRIMARY KEY ("care_site_id");

ALTER TABLE @cdmDatabaseSchema."provider" ADD PRIMARY KEY ("provider_id");

ALTER TABLE @cdmDatabaseSchema."payer_plan_period" ADD PRIMARY KEY ("payer_plan_period_id");

ALTER TABLE @cdmDatabaseSchema."cost" ADD PRIMARY KEY ("cost_id");

ALTER TABLE @cdmDatabaseSchema."drug_era" ADD PRIMARY KEY ("drug_era_id");

ALTER TABLE @cdmDatabaseSchema."dose_era" ADD PRIMARY KEY ("dose_era_id");

ALTER TABLE @cdmDatabaseSchema."condition_era" ADD PRIMARY KEY ("condition_era_id");

ALTER TABLE @cdmDatabaseSchema."episode" ADD PRIMARY KEY ("episode_id");

ALTER TABLE @cdmDatabaseSchema."metadata" ADD PRIMARY KEY ("metadata_id");

ALTER TABLE @cdmDatabaseSchema."concept" ADD PRIMARY KEY ("concept_id");

ALTER TABLE @cdmDatabaseSchema."vocabulary" ADD PRIMARY KEY ("vocabulary_id");

ALTER TABLE @cdmDatabaseSchema."domain" ADD PRIMARY KEY ("domain_id");

ALTER TABLE @cdmDatabaseSchema."concept_class" ADD PRIMARY KEY ("concept_class_id");

ALTER TABLE @cdmDatabaseSchema."relationship" ADD PRIMARY KEY ("relationship_id");

ALTER TABLE @cdmDatabaseSchema."person" ADD FOREIGN KEY ("gender_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."person" ADD FOREIGN KEY ("race_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."person" ADD FOREIGN KEY ("ethnicity_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."person" ADD FOREIGN KEY ("location_id") REFERENCES @cdmDatabaseSchema."location" ("location_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."person" ADD FOREIGN KEY ("provider_id") REFERENCES @cdmDatabaseSchema."provider" ("provider_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."person" ADD FOREIGN KEY ("care_site_id") REFERENCES @cdmDatabaseSchema."care_site" ("care_site_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."person" ADD FOREIGN KEY ("gender_source_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."person" ADD FOREIGN KEY ("race_source_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."person" ADD FOREIGN KEY ("ethnicity_source_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."observation_period" ADD FOREIGN KEY ("person_id") REFERENCES @cdmDatabaseSchema."person" ("person_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."observation_period" ADD FOREIGN KEY ("period_type_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ON @cdmDatabaseSchema."observation_period" (person_id);

ALTER TABLE @cdmDatabaseSchema."visit_occurrence" ADD FOREIGN KEY ("person_id") REFERENCES @cdmDatabaseSchema."person" ("person_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."visit_occurrence" ADD FOREIGN KEY ("visit_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."visit_occurrence" ADD FOREIGN KEY ("visit_type_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."visit_occurrence" ADD FOREIGN KEY ("provider_id") REFERENCES @cdmDatabaseSchema."provider" ("provider_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."visit_occurrence" ADD FOREIGN KEY ("care_site_id") REFERENCES @cdmDatabaseSchema."care_site" ("care_site_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."visit_occurrence" ADD FOREIGN KEY ("visit_source_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."visit_occurrence" ADD FOREIGN KEY ("admitted_from_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."visit_occurrence" ADD FOREIGN KEY ("discharged_to_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."visit_occurrence" ADD FOREIGN KEY ("preceding_visit_occurrence_id") REFERENCES @cdmDatabaseSchema."visit_occurrence" ("visit_occurrence_id") DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ON @cdmDatabaseSchema."visit_occurrence" (person_id);

ALTER TABLE @cdmDatabaseSchema."visit_detail" ADD FOREIGN KEY ("person_id") REFERENCES @cdmDatabaseSchema."person" ("person_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."visit_detail" ADD FOREIGN KEY ("visit_detail_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."visit_detail" ADD FOREIGN KEY ("visit_detail_type_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."visit_detail" ADD FOREIGN KEY ("provider_id") REFERENCES @cdmDatabaseSchema."provider" ("provider_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."visit_detail" ADD FOREIGN KEY ("care_site_id") REFERENCES @cdmDatabaseSchema."care_site" ("care_site_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."visit_detail" ADD FOREIGN KEY ("visit_detail_source_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."visit_detail" ADD FOREIGN KEY ("admitted_from_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."visit_detail" ADD FOREIGN KEY ("discharged_to_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."visit_detail" ADD FOREIGN KEY ("preceding_visit_detail_id") REFERENCES @cdmDatabaseSchema."visit_detail" ("visit_detail_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."visit_detail" ADD FOREIGN KEY ("parent_visit_detail_id") REFERENCES @cdmDatabaseSchema."visit_detail" ("visit_detail_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."visit_detail" ADD FOREIGN KEY ("visit_occurrence_id") REFERENCES @cdmDatabaseSchema."visit_occurrence" ("visit_occurrence_id") DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ON @cdmDatabaseSchema."visit_detail" (person_id);

ALTER TABLE @cdmDatabaseSchema."condition_occurrence" ADD FOREIGN KEY ("person_id") REFERENCES @cdmDatabaseSchema."person" ("person_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."condition_occurrence" ADD FOREIGN KEY ("condition_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."condition_occurrence" ADD FOREIGN KEY ("condition_type_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."condition_occurrence" ADD FOREIGN KEY ("condition_status_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."condition_occurrence" ADD FOREIGN KEY ("provider_id") REFERENCES @cdmDatabaseSchema."provider" ("provider_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."condition_occurrence" ADD FOREIGN KEY ("visit_occurrence_id") REFERENCES @cdmDatabaseSchema."visit_occurrence" ("visit_occurrence_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."condition_occurrence" ADD FOREIGN KEY ("visit_detail_id") REFERENCES @cdmDatabaseSchema."visit_detail" ("visit_detail_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."condition_occurrence" ADD FOREIGN KEY ("condition_source_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ON @cdmDatabaseSchema."condition_occurrence" (person_id);

ALTER TABLE @cdmDatabaseSchema."drug_exposure" ADD FOREIGN KEY ("person_id") REFERENCES @cdmDatabaseSchema."person" ("person_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."drug_exposure" ADD FOREIGN KEY ("drug_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."drug_exposure" ADD FOREIGN KEY ("drug_type_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."drug_exposure" ADD FOREIGN KEY ("route_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."drug_exposure" ADD FOREIGN KEY ("provider_id") REFERENCES @cdmDatabaseSchema."provider" ("provider_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."drug_exposure" ADD FOREIGN KEY ("visit_occurrence_id") REFERENCES @cdmDatabaseSchema."visit_occurrence" ("visit_occurrence_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."drug_exposure" ADD FOREIGN KEY ("visit_detail_id") REFERENCES @cdmDatabaseSchema."visit_detail" ("visit_detail_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."drug_exposure" ADD FOREIGN KEY ("drug_source_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ON @cdmDatabaseSchema."drug_exposure" (person_id);

ALTER TABLE @cdmDatabaseSchema."procedure_occurrence" ADD FOREIGN KEY ("person_id") REFERENCES @cdmDatabaseSchema."person" ("person_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."procedure_occurrence" ADD FOREIGN KEY ("procedure_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."procedure_occurrence" ADD FOREIGN KEY ("procedure_type_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."procedure_occurrence" ADD FOREIGN KEY ("modifier_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."procedure_occurrence" ADD FOREIGN KEY ("provider_id") REFERENCES @cdmDatabaseSchema."provider" ("provider_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."procedure_occurrence" ADD FOREIGN KEY ("visit_occurrence_id") REFERENCES @cdmDatabaseSchema."visit_occurrence" ("visit_occurrence_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."procedure_occurrence" ADD FOREIGN KEY ("visit_detail_id") REFERENCES @cdmDatabaseSchema."visit_detail" ("visit_detail_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."procedure_occurrence" ADD FOREIGN KEY ("procedure_source_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ON @cdmDatabaseSchema."procedure_occurrence" (person_id);

ALTER TABLE @cdmDatabaseSchema."device_exposure" ADD FOREIGN KEY ("person_id") REFERENCES @cdmDatabaseSchema."person" ("person_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."device_exposure" ADD FOREIGN KEY ("device_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."device_exposure" ADD FOREIGN KEY ("device_type_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."device_exposure" ADD FOREIGN KEY ("provider_id") REFERENCES @cdmDatabaseSchema."provider" ("provider_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."device_exposure" ADD FOREIGN KEY ("visit_occurrence_id") REFERENCES @cdmDatabaseSchema."visit_occurrence" ("visit_occurrence_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."device_exposure" ADD FOREIGN KEY ("visit_detail_id") REFERENCES @cdmDatabaseSchema."visit_detail" ("visit_detail_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."device_exposure" ADD FOREIGN KEY ("device_source_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."device_exposure" ADD FOREIGN KEY ("unit_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."device_exposure" ADD FOREIGN KEY ("unit_source_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ON @cdmDatabaseSchema."device_exposure" (person_id);

ALTER TABLE @cdmDatabaseSchema."measurement" ADD FOREIGN KEY ("person_id") REFERENCES @cdmDatabaseSchema."person" ("person_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."measurement" ADD FOREIGN KEY ("measurement_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."measurement" ADD FOREIGN KEY ("measurement_type_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."measurement" ADD FOREIGN KEY ("operator_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."measurement" ADD FOREIGN KEY ("value_as_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."measurement" ADD FOREIGN KEY ("unit_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."measurement" ADD FOREIGN KEY ("provider_id") REFERENCES @cdmDatabaseSchema."provider" ("provider_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."measurement" ADD FOREIGN KEY ("visit_occurrence_id") REFERENCES @cdmDatabaseSchema."visit_occurrence" ("visit_occurrence_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."measurement" ADD FOREIGN KEY ("visit_detail_id") REFERENCES @cdmDatabaseSchema."visit_detail" ("visit_detail_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."measurement" ADD FOREIGN KEY ("measurement_source_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."measurement" ADD FOREIGN KEY ("unit_source_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."measurement" ADD FOREIGN KEY ("meas_event_field_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ON @cdmDatabaseSchema."measurement" (person_id);

ALTER TABLE @cdmDatabaseSchema."observation" ADD FOREIGN KEY ("person_id") REFERENCES @cdmDatabaseSchema."person" ("person_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."observation" ADD FOREIGN KEY ("observation_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."observation" ADD FOREIGN KEY ("observation_type_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."observation" ADD FOREIGN KEY ("value_as_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."observation" ADD FOREIGN KEY ("qualifier_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."observation" ADD FOREIGN KEY ("unit_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."observation" ADD FOREIGN KEY ("provider_id") REFERENCES @cdmDatabaseSchema."provider" ("provider_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."observation" ADD FOREIGN KEY ("visit_occurrence_id") REFERENCES @cdmDatabaseSchema."visit_occurrence" ("visit_occurrence_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."observation" ADD FOREIGN KEY ("visit_detail_id") REFERENCES @cdmDatabaseSchema."visit_detail" ("visit_detail_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."observation" ADD FOREIGN KEY ("observation_source_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."observation" ADD FOREIGN KEY ("obs_event_field_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ON @cdmDatabaseSchema."observation" (person_id);

ALTER TABLE @cdmDatabaseSchema."death" ADD FOREIGN KEY ("person_id") REFERENCES @cdmDatabaseSchema."person" ("person_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."death" ADD FOREIGN KEY ("death_type_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."death" ADD FOREIGN KEY ("cause_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."death" ADD FOREIGN KEY ("cause_source_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ON @cdmDatabaseSchema."death" (person_id);

ALTER TABLE @cdmDatabaseSchema."note" ADD FOREIGN KEY ("person_id") REFERENCES @cdmDatabaseSchema."person" ("person_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."note" ADD FOREIGN KEY ("note_type_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."note" ADD FOREIGN KEY ("note_class_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."note" ADD FOREIGN KEY ("encoding_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."note" ADD FOREIGN KEY ("language_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."note" ADD FOREIGN KEY ("provider_id") REFERENCES @cdmDatabaseSchema."provider" ("provider_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."note" ADD FOREIGN KEY ("visit_occurrence_id") REFERENCES @cdmDatabaseSchema."visit_occurrence" ("visit_occurrence_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."note" ADD FOREIGN KEY ("visit_detail_id") REFERENCES @cdmDatabaseSchema."visit_detail" ("visit_detail_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."note" ADD FOREIGN KEY ("note_event_field_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ON @cdmDatabaseSchema."note" (person_id);

ALTER TABLE @cdmDatabaseSchema."note_nlp" ADD FOREIGN KEY ("note_id") REFERENCES @cdmDatabaseSchema."note" ("note_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."note_nlp" ADD FOREIGN KEY ("section_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."note_nlp" ADD FOREIGN KEY ("note_nlp_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."note_nlp" ADD FOREIGN KEY ("note_nlp_source_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."specimen" ADD FOREIGN KEY ("person_id") REFERENCES @cdmDatabaseSchema."person" ("person_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."specimen" ADD FOREIGN KEY ("specimen_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."specimen" ADD FOREIGN KEY ("specimen_type_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."specimen" ADD FOREIGN KEY ("unit_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."specimen" ADD FOREIGN KEY ("anatomic_site_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."specimen" ADD FOREIGN KEY ("disease_status_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ON @cdmDatabaseSchema."specimen" (person_id);

ALTER TABLE @cdmDatabaseSchema."fact_relationship" ADD FOREIGN KEY ("domain_concept_id_1") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."fact_relationship" ADD FOREIGN KEY ("domain_concept_id_2") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."fact_relationship" ADD FOREIGN KEY ("relationship_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."location" ADD FOREIGN KEY ("country_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."care_site" ADD FOREIGN KEY ("place_of_service_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."care_site" ADD FOREIGN KEY ("location_id") REFERENCES @cdmDatabaseSchema."location" ("location_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."provider" ADD FOREIGN KEY ("specialty_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."provider" ADD FOREIGN KEY ("care_site_id") REFERENCES @cdmDatabaseSchema."care_site" ("care_site_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."provider" ADD FOREIGN KEY ("gender_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."provider" ADD FOREIGN KEY ("specialty_source_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."provider" ADD FOREIGN KEY ("gender_source_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."payer_plan_period" ADD FOREIGN KEY ("person_id") REFERENCES @cdmDatabaseSchema."person" ("person_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."payer_plan_period" ADD FOREIGN KEY ("payer_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."payer_plan_period" ADD FOREIGN KEY ("payer_source_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."payer_plan_period" ADD FOREIGN KEY ("plan_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."payer_plan_period" ADD FOREIGN KEY ("plan_source_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."payer_plan_period" ADD FOREIGN KEY ("sponsor_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."payer_plan_period" ADD FOREIGN KEY ("sponsor_source_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."payer_plan_period" ADD FOREIGN KEY ("stop_reason_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."payer_plan_period" ADD FOREIGN KEY ("stop_reason_source_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ON @cdmDatabaseSchema."payer_plan_period" (person_id);

ALTER TABLE @cdmDatabaseSchema."cost" ADD FOREIGN KEY ("cost_domain_id") REFERENCES @cdmDatabaseSchema."domain" ("domain_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."cost" ADD FOREIGN KEY ("cost_type_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."cost" ADD FOREIGN KEY ("currency_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."cost" ADD FOREIGN KEY ("payer_plan_period_id") REFERENCES @cdmDatabaseSchema."payer_plan_period" ("payer_plan_period_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."cost" ADD FOREIGN KEY ("revenue_code_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."cost" ADD FOREIGN KEY ("drg_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."drug_era" ADD FOREIGN KEY ("person_id") REFERENCES @cdmDatabaseSchema."person" ("person_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."drug_era" ADD FOREIGN KEY ("drug_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ON @cdmDatabaseSchema."drug_era" (person_id);

ALTER TABLE @cdmDatabaseSchema."dose_era" ADD FOREIGN KEY ("person_id") REFERENCES @cdmDatabaseSchema."person" ("person_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."dose_era" ADD FOREIGN KEY ("drug_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."dose_era" ADD FOREIGN KEY ("unit_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ON @cdmDatabaseSchema."dose_era" (person_id);

ALTER TABLE @cdmDatabaseSchema."condition_era" ADD FOREIGN KEY ("person_id") REFERENCES @cdmDatabaseSchema."person" ("person_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."condition_era" ADD FOREIGN KEY ("condition_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ON @cdmDatabaseSchema."condition_era" (person_id);

ALTER TABLE @cdmDatabaseSchema."episode" ADD FOREIGN KEY ("person_id") REFERENCES @cdmDatabaseSchema."person" ("person_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."episode" ADD FOREIGN KEY ("episode_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."episode" ADD FOREIGN KEY ("episode_parent_id") REFERENCES @cdmDatabaseSchema."episode" ("episode_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."episode" ADD FOREIGN KEY ("episode_object_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."episode" ADD FOREIGN KEY ("episode_type_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."episode" ADD FOREIGN KEY ("episode_source_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ON @cdmDatabaseSchema."episode" (person_id);

ALTER TABLE @cdmDatabaseSchema."episode_event" ADD FOREIGN KEY ("episode_id") REFERENCES @cdmDatabaseSchema."episode" ("episode_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."episode_event" ADD FOREIGN KEY ("episode_event_field_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."metadata" ADD FOREIGN KEY ("metadata_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."metadata" ADD FOREIGN KEY ("metadata_type_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."metadata" ADD FOREIGN KEY ("value_as_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."cdm_source" ADD FOREIGN KEY ("cdm_version_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."concept" ADD FOREIGN KEY ("domain_id") REFERENCES @cdmDatabaseSchema."domain" ("domain_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."concept" ADD FOREIGN KEY ("vocabulary_id") REFERENCES @cdmDatabaseSchema."vocabulary" ("vocabulary_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."concept" ADD FOREIGN KEY ("concept_class_id") REFERENCES @cdmDatabaseSchema."concept_class" ("concept_class_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."vocabulary" ADD FOREIGN KEY ("vocabulary_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."domain" ADD FOREIGN KEY ("domain_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."concept_class" ADD FOREIGN KEY ("concept_class_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."concept_relationship" ADD FOREIGN KEY ("concept_id_1") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."concept_relationship" ADD FOREIGN KEY ("concept_id_2") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."concept_relationship" ADD FOREIGN KEY ("relationship_id") REFERENCES @cdmDatabaseSchema."relationship" ("relationship_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."relationship" ADD FOREIGN KEY ("reverse_relationship_id") REFERENCES @cdmDatabaseSchema."relationship" ("relationship_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."relationship" ADD FOREIGN KEY ("relationship_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."concept_synonym" ADD FOREIGN KEY ("concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."concept_synonym" ADD FOREIGN KEY ("language_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."concept_ancestor" ADD FOREIGN KEY ("ancestor_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."concept_ancestor" ADD FOREIGN KEY ("descendant_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."source_to_concept_map" ADD FOREIGN KEY ("source_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."source_to_concept_map" ADD FOREIGN KEY ("source_vocabulary_id") REFERENCES @cdmDatabaseSchema."vocabulary" ("vocabulary_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."source_to_concept_map" ADD FOREIGN KEY ("target_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."source_to_concept_map" ADD FOREIGN KEY ("target_vocabulary_id") REFERENCES @cdmDatabaseSchema."vocabulary" ("vocabulary_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."drug_strength" ADD FOREIGN KEY ("drug_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."drug_strength" ADD FOREIGN KEY ("ingredient_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."drug_strength" ADD FOREIGN KEY ("amount_unit_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."drug_strength" ADD FOREIGN KEY ("numerator_unit_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."drug_strength" ADD FOREIGN KEY ("denominator_unit_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."cohort_definition" ADD FOREIGN KEY ("definition_type_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE @cdmDatabaseSchema."cohort_definition" ADD FOREIGN KEY ("subject_concept_id") REFERENCES @cdmDatabaseSchema."concept" ("concept_id") DEFERRABLE INITIALLY DEFERRED;
