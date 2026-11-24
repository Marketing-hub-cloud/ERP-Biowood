-- CreateEnum
CREATE TYPE "PurchaseStatus" AS ENUM ('DRAFT', 'PENDING', 'APPROVED', 'PARTIAL', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "VatMode" AS ENUM ('EXCLUSIVE', 'INCLUSIVE', 'NONE');

-- CreateEnum
CREATE TYPE "ApprovalActionType" AS ENUM ('SUBMIT', 'APPROVE', 'REJECT', 'CANCEL');

-- AlterEnum
ALTER TYPE "LookupKind" ADD VALUE 'RETURN_REASON';

-- AlterTable
ALTER TABLE "goods_issue_lines" ADD COLUMN     "returnLineId" TEXT;

-- AlterTable
ALTER TABLE "goods_issues" ADD COLUMN     "purchaseReturnId" TEXT;

-- AlterTable
ALTER TABLE "goods_receipt_lines" ADD COLUMN     "orderLineId" TEXT;

-- AlterTable
ALTER TABLE "goods_receipts" ADD COLUMN     "purchaseOrderId" TEXT;

-- AlterTable
ALTER TABLE "group_permissions" ADD COLUMN     "canApprove" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "approval_steps" (
    "id" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "stepNo" INTEGER NOT NULL,

    CONSTRAINT "approval_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_step_approvers" (
    "stepId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "approval_step_approvers_pkey" PRIMARY KEY ("stepId","userId")
);

-- CreateTable
CREATE TABLE "approval_actions" (
    "id" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "docId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "stepNo" INTEGER,
    "action" "ApprovalActionType" NOT NULL,
    "actorId" TEXT NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_requests" (
    "id" TEXT NOT NULL,
    "docNo" TEXT NOT NULL,
    "status" "PurchaseStatus" NOT NULL DEFAULT 'DRAFT',
    "docDate" DATE NOT NULL,
    "requiredDate" DATE,
    "requesterId" TEXT NOT NULL,
    "department" TEXT,
    "position" TEXT,
    "reference" TEXT,
    "warehouseId" TEXT,
    "note" TEXT,
    "approvalSnapshot" JSONB,
    "currentStep" INTEGER,
    "approvalRound" INTEGER NOT NULL DEFAULT 0,
    "submittedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelReason" TEXT,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_request_lines" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "note" TEXT,

    CONSTRAINT "purchase_request_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" TEXT NOT NULL,
    "docNo" TEXT NOT NULL,
    "status" "PurchaseStatus" NOT NULL DEFAULT 'DRAFT',
    "docDate" DATE NOT NULL,
    "deliveryDate" DATE,
    "vendorId" TEXT NOT NULL,
    "paymentTerms" TEXT,
    "reference" TEXT,
    "warehouseId" TEXT,
    "note" TEXT,
    "vatMode" "VatMode" NOT NULL DEFAULT 'EXCLUSIVE',
    "vatRate" DECIMAL(5,2) NOT NULL DEFAULT 7,
    "headerDiscount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "vatAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "approvalSnapshot" JSONB,
    "currentStep" INTEGER,
    "approvalRound" INTEGER NOT NULL DEFAULT 0,
    "submittedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelReason" TEXT,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_lines" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "productId" TEXT NOT NULL,
    "requestLineId" TEXT,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unitPrice" DECIMAL(14,4) NOT NULL,
    "discount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "amount" DECIMAL(14,2) NOT NULL,
    "note" TEXT,

    CONSTRAINT "purchase_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_returns" (
    "id" TEXT NOT NULL,
    "docNo" TEXT NOT NULL,
    "status" "PurchaseStatus" NOT NULL DEFAULT 'DRAFT',
    "docDate" DATE NOT NULL,
    "orderId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "reasonId" TEXT NOT NULL,
    "note" TEXT,
    "approvalSnapshot" JSONB,
    "currentStep" INTEGER,
    "approvalRound" INTEGER NOT NULL DEFAULT 0,
    "submittedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelReason" TEXT,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_return_lines" (
    "id" TEXT NOT NULL,
    "returnId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "orderLineId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "note" TEXT,

    CONSTRAINT "purchase_return_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "note_templates" (
    "id" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "note_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "approval_steps_docType_stepNo_key" ON "approval_steps"("docType", "stepNo");

-- CreateIndex
CREATE INDEX "approval_actions_docType_docId_idx" ON "approval_actions"("docType", "docId");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_requests_docNo_key" ON "purchase_requests"("docNo");

-- CreateIndex
CREATE INDEX "purchase_requests_status_docDate_idx" ON "purchase_requests"("status", "docDate");

-- CreateIndex
CREATE INDEX "purchase_request_lines_requestId_idx" ON "purchase_request_lines"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_docNo_key" ON "purchase_orders"("docNo");

-- CreateIndex
CREATE INDEX "purchase_orders_status_docDate_idx" ON "purchase_orders"("status", "docDate");

-- CreateIndex
CREATE INDEX "purchase_orders_vendorId_idx" ON "purchase_orders"("vendorId");

-- CreateIndex
CREATE INDEX "purchase_order_lines_orderId_idx" ON "purchase_order_lines"("orderId");

-- CreateIndex
CREATE INDEX "purchase_order_lines_requestLineId_idx" ON "purchase_order_lines"("requestLineId");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_returns_docNo_key" ON "purchase_returns"("docNo");

-- CreateIndex
CREATE INDEX "purchase_returns_status_docDate_idx" ON "purchase_returns"("status", "docDate");

-- CreateIndex
CREATE INDEX "purchase_returns_orderId_idx" ON "purchase_returns"("orderId");

-- CreateIndex
CREATE INDEX "purchase_return_lines_returnId_idx" ON "purchase_return_lines"("returnId");

-- CreateIndex
CREATE INDEX "purchase_return_lines_orderLineId_idx" ON "purchase_return_lines"("orderLineId");

-- CreateIndex
CREATE INDEX "note_templates_module_idx" ON "note_templates"("module");

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "purchase_order_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_issues" ADD CONSTRAINT "goods_issues_purchaseReturnId_fkey" FOREIGN KEY ("purchaseReturnId") REFERENCES "purchase_returns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_issue_lines" ADD CONSTRAINT "goods_issue_lines_returnLineId_fkey" FOREIGN KEY ("returnLineId") REFERENCES "purchase_return_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_step_approvers" ADD CONSTRAINT "approval_step_approvers_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "approval_steps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_step_approvers" ADD CONSTRAINT "approval_step_approvers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_actions" ADD CONSTRAINT "approval_actions_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "stock_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_request_lines" ADD CONSTRAINT "purchase_request_lines_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "purchase_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_request_lines" ADD CONSTRAINT "purchase_request_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "stock_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_requestLineId_fkey" FOREIGN KEY ("requestLineId") REFERENCES "purchase_request_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_reasonId_fkey" FOREIGN KEY ("reasonId") REFERENCES "lookup_options"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_return_lines" ADD CONSTRAINT "purchase_return_lines_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "purchase_returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_return_lines" ADD CONSTRAINT "purchase_return_lines_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "purchase_order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_return_lines" ADD CONSTRAINT "purchase_return_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- กันข้อมูลผิดที่ระดับฐานข้อมูล
ALTER TABLE "purchase_request_lines" ADD CONSTRAINT "purchase_request_lines_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_price_nonneg" CHECK ("unitPrice" >= 0 AND "discount" >= 0);
ALTER TABLE "purchase_return_lines" ADD CONSTRAINT "purchase_return_lines_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_step_range" CHECK ("stepNo" BETWEEN 1 AND 3);
