-- DropForeignKey
ALTER TABLE "appointments" DROP CONSTRAINT "appointments_care_thread_id_fkey";

-- DropForeignKey
ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_actor_user_id_fkey";

-- DropForeignKey
ALTER TABLE "care_threads" DROP CONSTRAINT "care_threads_primary_clinician_id_fkey";

-- DropForeignKey
ALTER TABLE "check_ins" DROP CONSTRAINT "check_ins_reviewed_by_id_fkey";

-- DropForeignKey
ALTER TABLE "clinician_profiles" DROP CONSTRAINT "clinician_profiles_facility_id_fkey";

-- DropForeignKey
ALTER TABLE "consultation_notes" DROP CONSTRAINT "consultation_notes_referred_specialist_id_fkey";

-- DropForeignKey
ALTER TABLE "consultation_requests" DROP CONSTRAINT "consultation_requests_appointment_id_fkey";

-- DropForeignKey
ALTER TABLE "consultation_requests" DROP CONSTRAINT "consultation_requests_assigned_clinician_id_fkey";

-- DropForeignKey
ALTER TABLE "consultation_requests" DROP CONSTRAINT "consultation_requests_referred_from_consultation_id_fkey";

-- DropForeignKey
ALTER TABLE "medical_records" DROP CONSTRAINT "medical_records_care_thread_id_fkey";

-- DropForeignKey
ALTER TABLE "medical_records" DROP CONSTRAINT "medical_records_recorded_by_id_fkey";

-- DropForeignKey
ALTER TABLE "medical_records" DROP CONSTRAINT "medical_records_source_facility_id_fkey";

-- DropForeignKey
ALTER TABLE "messages" DROP CONSTRAINT "messages_consultation_id_fkey";

-- DropForeignKey
ALTER TABLE "patient_profiles" DROP CONSTRAINT "patient_profiles_guardian_user_id_fkey";

-- AddForeignKey
ALTER TABLE "patient_profiles" ADD CONSTRAINT "patient_profiles_guardian_user_id_fkey" FOREIGN KEY ("guardian_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinician_profiles" ADD CONSTRAINT "clinician_profiles_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "facilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_care_thread_id_fkey" FOREIGN KEY ("care_thread_id") REFERENCES "care_threads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "care_threads" ADD CONSTRAINT "care_threads_primary_clinician_id_fkey" FOREIGN KEY ("primary_clinician_id") REFERENCES "clinician_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultation_requests" ADD CONSTRAINT "consultation_requests_assigned_clinician_id_fkey" FOREIGN KEY ("assigned_clinician_id") REFERENCES "clinician_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultation_requests" ADD CONSTRAINT "consultation_requests_referred_from_consultation_id_fkey" FOREIGN KEY ("referred_from_consultation_id") REFERENCES "consultation_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultation_requests" ADD CONSTRAINT "consultation_requests_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultation_notes" ADD CONSTRAINT "consultation_notes_referred_specialist_id_fkey" FOREIGN KEY ("referred_specialist_id") REFERENCES "clinician_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_consultation_id_fkey" FOREIGN KEY ("consultation_id") REFERENCES "consultation_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "clinician_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_records" ADD CONSTRAINT "medical_records_care_thread_id_fkey" FOREIGN KEY ("care_thread_id") REFERENCES "care_threads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_records" ADD CONSTRAINT "medical_records_source_facility_id_fkey" FOREIGN KEY ("source_facility_id") REFERENCES "facilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_records" ADD CONSTRAINT "medical_records_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "clinician_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
