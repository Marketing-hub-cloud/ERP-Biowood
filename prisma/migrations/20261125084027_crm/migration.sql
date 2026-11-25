-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('NEW', 'IN_PROGRESS', 'QUOTED', 'WON', 'CLOSED', 'AFTERCARE', 'ENGINEERING', 'SHIPPING', 'PAYMENT');

-- CreateEnum
CREATE TYPE "WorkPlanStatus" AS ENUM ('PLANNED', 'CHECKED_IN', 'DONE', 'CANCELLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "LookupKind" ADD VALUE 'PROJECT_WORK_STAGE';
ALTER TYPE "LookupKind" ADD VALUE 'PROJECT_WORK_NATURE';

-- AlterTable
ALTER TABLE "engineer_docs" ADD COLUMN     "projectId" TEXT;

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "ProjectStatus" NOT NULL DEFAULT 'NEW',
    "customerId" TEXT NOT NULL,
    "contactPerson" TEXT,
    "salesRepId" TEXT,
    "businessTypeId" TEXT,
    "workStageId" TEXT,
    "workNatureId" TEXT,
    "workDetail" TEXT,
    "probability" INTEGER,
    "expectedCloseDate" DATE,
    "value" DECIMAL(14,2),
    "warrantyStart" DATE,
    "warrantyEnd" DATE,
    "warrantyNote" TEXT,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_tags" (
    "projectId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "project_tags_pkey" PRIMARY KEY ("projectId","tagId")
);

-- CreateTable
CREATE TABLE "work_plans" (
    "id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "status" "WorkPlanStatus" NOT NULL DEFAULT 'PLANNED',
    "plannedStart" TIMESTAMP(3) NOT NULL,
    "plannedEnd" TIMESTAMP(3) NOT NULL,
    "employeeId" TEXT NOT NULL,
    "customerId" TEXT,
    "projectId" TEXT,
    "location" TEXT,
    "detail" TEXT,
    "startLat" DECIMAL(9,6),
    "startLng" DECIMAL(9,6),
    "startAccuracy" INTEGER,
    "startAt" TIMESTAMP(3),
    "endLat" DECIMAL(9,6),
    "endLng" DECIMAL(9,6),
    "endAccuracy" INTEGER,
    "endAt" TIMESTAMP(3),
    "distanceKm" DECIMAL(10,3),
    "distanceSource" TEXT,
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_plans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "projects_customerId_deletedAt_idx" ON "projects"("customerId", "deletedAt");

-- CreateIndex
CREATE INDEX "projects_salesRepId_idx" ON "projects"("salesRepId");

-- CreateIndex
CREATE INDEX "projects_status_idx" ON "projects"("status");

-- CreateIndex
CREATE INDEX "project_tags_tagId_idx" ON "project_tags"("tagId");

-- CreateIndex
CREATE INDEX "work_plans_employeeId_plannedStart_idx" ON "work_plans"("employeeId", "plannedStart");

-- CreateIndex
CREATE INDEX "work_plans_plannedStart_idx" ON "work_plans"("plannedStart");

-- CreateIndex
CREATE INDEX "work_plans_projectId_idx" ON "work_plans"("projectId");

-- CreateIndex
CREATE INDEX "engineer_docs_projectId_idx" ON "engineer_docs"("projectId");

-- AddForeignKey
ALTER TABLE "engineer_docs" ADD CONSTRAINT "engineer_docs_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_salesRepId_fkey" FOREIGN KEY ("salesRepId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_businessTypeId_fkey" FOREIGN KEY ("businessTypeId") REFERENCES "lookup_options"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_workStageId_fkey" FOREIGN KEY ("workStageId") REFERENCES "lookup_options"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_workNatureId_fkey" FOREIGN KEY ("workNatureId") REFERENCES "lookup_options"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_tags" ADD CONSTRAINT "project_tags_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_tags" ADD CONSTRAINT "project_tags_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_plans" ADD CONSTRAINT "work_plans_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_plans" ADD CONSTRAINT "work_plans_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_plans" ADD CONSTRAINT "work_plans_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_plans" ADD CONSTRAINT "work_plans_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
