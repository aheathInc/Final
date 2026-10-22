/*
  Warnings:

  - You are about to drop the column `deliver_after` on the `otp_challenges` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "notification_logs" ADD COLUMN     "deliver_after" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "otp_challenges" DROP COLUMN "deliver_after";
