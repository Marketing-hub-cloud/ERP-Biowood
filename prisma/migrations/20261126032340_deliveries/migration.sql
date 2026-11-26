-- CreateEnum
CREATE TYPE "DeliveryJobStatus" AS ENUM ('SCHEDULED', 'DELIVERED', 'CANCELLED');

-- CreateTable
CREATE TABLE "delivery_jobs" (
    "id" TEXT NOT NULL,
    "goodsIssueId" TEXT NOT NULL,
    "status" "DeliveryJobStatus" NOT NULL DEFAULT 'SCHEDULED',
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "driverId" TEXT NOT NULL,
    "mapUrl" TEXT,
    "shippingAddress" TEXT,
    "note" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "delivery_jobs_driverId_startAt_idx" ON "delivery_jobs"("driverId", "startAt");

-- CreateIndex
CREATE INDEX "delivery_jobs_startAt_idx" ON "delivery_jobs"("startAt");

-- CreateIndex
CREATE INDEX "delivery_jobs_goodsIssueId_idx" ON "delivery_jobs"("goodsIssueId");

-- AddForeignKey
ALTER TABLE "delivery_jobs" ADD CONSTRAINT "delivery_jobs_goodsIssueId_fkey" FOREIGN KEY ("goodsIssueId") REFERENCES "goods_issues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_jobs" ADD CONSTRAINT "delivery_jobs_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_jobs" ADD CONSTRAINT "delivery_jobs_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
