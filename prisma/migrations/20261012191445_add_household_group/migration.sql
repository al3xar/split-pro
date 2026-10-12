-- AlterTable
ALTER TABLE "Group" ADD COLUMN     "householdSince" TIMESTAMP(3),
ADD COLUMN     "isHousehold" BOOLEAN NOT NULL DEFAULT false;
