-- Historical digital front-desk visits were physically attended, despite the
-- old chat default. Preserve financial history; no existing bills are deleted.
UPDATE "consultation_requests" c
SET "consultation_mode" = 'hospital', "modality" = 'in_person',
    "facility_id" = v."facility_id", "facility_name" = f."name", "consultation_fee_amount" = 0
FROM "front_desk_visits" v JOIN "facilities" f ON f."id" = v."facility_id"
WHERE v."consultation_id" = c."id";
ALTER TABLE "consultation_requests" ADD CONSTRAINT "consultation_mode_details_check"
  CHECK (("consultation_mode" = 'hospital' AND "facility_id" IS NOT NULL AND "modality" = 'in_person')
      OR ("consultation_mode" = 'remote' AND "modality" <> 'in_person'));
