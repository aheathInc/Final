-- PostgreSQL truncates identifiers to 63 bytes. Prisma's schema naming keeps
-- the relation/index suffix when it computes long identifiers, so align the
-- database names after the original forward migration on every deployment.
ALTER TABLE "provider_clinical_collaboration_messages"
  RENAME CONSTRAINT "provider_clinical_collaboration_messages_author_clinician_id_fk"
  TO "provider_clinical_collaboration_messages_author_clinician__fkey";

ALTER INDEX "provider_clinical_collaboration_messages_collaboration_id_creat"
  RENAME TO "provider_clinical_collaboration_messages_collaboration_id_c_idx";

ALTER INDEX "provider_clinical_collaborations_invited_clinician_id_status_re"
  RENAME TO "provider_clinical_collaborations_invited_clinician_id_statu_idx";

ALTER INDEX "provider_clinical_collaborations_requester_clinician_id_status_"
  RENAME TO "provider_clinical_collaborations_requester_clinician_id_sta_idx";
