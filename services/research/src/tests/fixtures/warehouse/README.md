# Synthetic OMOP acceptance fixture

All records here are fabricated. No real patient, hospital or proprietary vocabulary
is included. `clinical-synthetic.json` has 20 synthetic people with explicit event
dates and observation periods, multiple clinical domains, coded units and relationships.

`vocabulary/` is a tiny **NON-CLINICAL** Athena-layout TSV fixture. It is not a clinical
terminology release, and must never process real data. Test concept names explicitly
identify synthetic content; IDs are used only to exercise schema and ETL contracts.
The ten files, including empty vocabulary tables, have SHA-256 hashes in `manifest.json`.

Actual OHDSI vocabularies must be obtained separately from Athena under applicable
licences. No automatic download, redistribution, model training or clinical-use
permission is implied by this fixture.
