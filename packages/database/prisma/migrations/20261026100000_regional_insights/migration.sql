CREATE TYPE "ReportingLevel" AS ENUM ('country', 'region', 'district', 'ward', 'village');
CREATE TABLE "reporting_areas" (
  "code" VARCHAR(64) PRIMARY KEY,
  "name" VARCHAR(150) NOT NULL,
  "level" "ReportingLevel" NOT NULL,
  "parent_code" VARCHAR(64) REFERENCES "reporting_areas"("code") ON DELETE RESTRICT,
  "latitude" DOUBLE PRECISION,
  "longitude" DOUBLE PRECISION,
  "source" VARCHAR(300) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "reporting_area_root" CHECK ((level = 'country') = (parent_code IS NULL)),
  CONSTRAINT "reporting_area_coordinates" CHECK (
    (latitude IS NULL AND longitude IS NULL) OR
    (latitude IS NOT NULL AND longitude IS NOT NULL AND latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)
  )
);
CREATE INDEX "reporting_areas_parent_code_level_idx" ON "reporting_areas"("parent_code", "level");
ALTER TABLE "patient_profiles" ADD COLUMN "reporting_area_code" VARCHAR(64) REFERENCES "reporting_areas"("code") ON DELETE RESTRICT;
CREATE INDEX "patient_profiles_reporting_area_code_idx" ON "patient_profiles"("reporting_area_code");
CREATE TABLE "regional_insight_releases" (
  "period" VARCHAR(7) PRIMARY KEY,
  "payload" JSONB NOT NULL,
  "published_by" UUID NOT NULL,
  "published_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
