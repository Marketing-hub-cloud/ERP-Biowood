-- CreateEnum
CREATE TYPE "EngineerStatus" AS ENUM ('DRAFT', 'NEW', 'REVIEWED', 'QUEUED', 'ASSIGNED', 'IN_PROGRESS', 'INSPECTION', 'ESTIMATE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EngineerWorkType" AS ENUM ('SURVEY', 'INSTALL', 'CHANGE');

-- CreateEnum
CREATE TYPE "EngineerUrgency" AS ENUM ('NORMAL', 'URGENT');

-- CreateEnum
CREATE TYPE "EngineerFileKind" AS ENUM ('CUSTOMER_DRAWING', 'RETURN_DOC');

-- CreateTable
CREATE TABLE "engineer_docs" (
    "id" TEXT NOT NULL,
    "docNo" TEXT NOT NULL,
    "status" "EngineerStatus" NOT NULL DEFAULT 'DRAFT',
    "docDate" DATE NOT NULL,
    "startDate" DATE,
    "dueDate" DATE,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "workTypes" "EngineerWorkType"[],
    "workDetail" TEXT,
    "projectName" TEXT NOT NULL,
    "urgency" "EngineerUrgency" NOT NULL DEFAULT 'NORMAL',
    "customerId" TEXT,
    "addressLabel" TEXT,
    "siteAddress" TEXT,
    "assigneeId" TEXT,
    "note" TEXT,
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelReason" TEXT,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "engineer_docs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engineer_participants" (
    "docId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "engineer_participants_pkey" PRIMARY KEY ("docId","userId")
);

-- CreateTable
CREATE TABLE "engineer_files" (
    "id" TEXT NOT NULL,
    "docId" TEXT NOT NULL,
    "kind" "EngineerFileKind" NOT NULL,
    "key" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "engineer_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engineer_estimate_lines" (
    "id" TEXT NOT NULL,
    "docId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "note" TEXT,

    CONSTRAINT "engineer_estimate_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engineer_step_logs" (
    "id" TEXT NOT NULL,
    "docId" TEXT NOT NULL,
    "fromStatus" "EngineerStatus",
    "toStatus" "EngineerStatus" NOT NULL,
    "actorId" TEXT NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "engineer_step_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "engineer_docs_docNo_key" ON "engineer_docs"("docNo");

-- CreateIndex
CREATE INDEX "engineer_docs_status_docDate_idx" ON "engineer_docs"("status", "docDate");

-- CreateIndex
CREATE INDEX "engineer_docs_customerId_idx" ON "engineer_docs"("customerId");

-- CreateIndex
CREATE INDEX "engineer_docs_assigneeId_idx" ON "engineer_docs"("assigneeId");

-- CreateIndex
CREATE INDEX "engineer_participants_userId_idx" ON "engineer_participants"("userId");

-- CreateIndex
CREATE INDEX "engineer_files_docId_idx" ON "engineer_files"("docId");

-- CreateIndex
CREATE INDEX "engineer_estimate_lines_docId_idx" ON "engineer_estimate_lines"("docId");

-- CreateIndex
CREATE INDEX "engineer_step_logs_docId_createdAt_idx" ON "engineer_step_logs"("docId", "createdAt");

-- AddForeignKey
ALTER TABLE "engineer_docs" ADD CONSTRAINT "engineer_docs_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engineer_docs" ADD CONSTRAINT "engineer_docs_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engineer_docs" ADD CONSTRAINT "engineer_docs_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engineer_docs" ADD CONSTRAINT "engineer_docs_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engineer_participants" ADD CONSTRAINT "engineer_participants_docId_fkey" FOREIGN KEY ("docId") REFERENCES "engineer_docs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engineer_participants" ADD CONSTRAINT "engineer_participants_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engineer_files" ADD CONSTRAINT "engineer_files_docId_fkey" FOREIGN KEY ("docId") REFERENCES "engineer_docs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engineer_files" ADD CONSTRAINT "engineer_files_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engineer_estimate_lines" ADD CONSTRAINT "engineer_estimate_lines_docId_fkey" FOREIGN KEY ("docId") REFERENCES "engineer_docs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engineer_estimate_lines" ADD CONSTRAINT "engineer_estimate_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engineer_step_logs" ADD CONSTRAINT "engineer_step_logs_docId_fkey" FOREIGN KEY ("docId") REFERENCES "engineer_docs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engineer_step_logs" ADD CONSTRAINT "engineer_step_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
