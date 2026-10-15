# Synthetic interoperability fixtures

**TEST DATA ONLY — NOT FOR CLINICAL USE**

These fixture resources are fictional and are never loaded into `ahealth_dev` or a production service. They describe two synthetic source systems (`hospital-a-ehr` and `hospital-b-ehr`), Patient A and Patient B, and supported resource examples. Import them only from an isolated test runner targeting `ahealth_test` after confirming its host and non-5432 port. Patient A/Patient B labels and clinician roles in `test-actors.json` are scenario names, not live user identifiers.

The fixtures exercise confirmed, ambiguous and unmatched identity scenarios through test setup; the JSON files themselves do not assert or create an AHP patient mapping.
