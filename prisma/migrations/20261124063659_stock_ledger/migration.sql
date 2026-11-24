-- CreateEnum
CREATE TYPE "GoodsReceiptType" AS ENUM ('PURCHASE', 'OTHER');

-- CreateEnum
CREATE TYPE "GoodsIssueType" AS ENUM ('SALE', 'RETURN', 'SAMPLE', 'OTHER');

-- CreateEnum
CREATE TYPE "StockDocStatus" AS ENUM ('DRAFT', 'POSTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MovementType" AS ENUM ('RECEIPT', 'ISSUE', 'RECEIPT_REVERSAL', 'ISSUE_REVERSAL');

-- CreateTable
CREATE TABLE "goods_receipts" (
    "id" TEXT NOT NULL,
    "docNo" TEXT NOT NULL,
    "type" "GoodsReceiptType" NOT NULL DEFAULT 'OTHER',
    "docDate" DATE NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "lot" TEXT,
    "note" TEXT,
    "status" "StockDocStatus" NOT NULL DEFAULT 'DRAFT',
    "postedAt" TIMESTAMP(3),
    "postedById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelReason" TEXT,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "goods_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipt_lines" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "productId" TEXT NOT NULL,
    "locationId" TEXT,
    "note" TEXT,

    CONSTRAINT "goods_receipt_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_serials" (
    "id" TEXT NOT NULL,
    "barcode" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "productId" TEXT NOT NULL,
    "receiptLineId" TEXT NOT NULL,
    "initialQty" DECIMAL(14,3) NOT NULL,
    "warehouseId" TEXT,
    "locationId" TEXT,
    "lot" TEXT,
    "scannedAt" TIMESTAMP(3),
    "scannedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_serials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_issues" (
    "id" TEXT NOT NULL,
    "docNo" TEXT NOT NULL,
    "type" "GoodsIssueType" NOT NULL,
    "docDate" DATE NOT NULL,
    "contactId" TEXT,
    "recipientName" TEXT,
    "shippingAddress" TEXT,
    "note" TEXT,
    "status" "StockDocStatus" NOT NULL DEFAULT 'DRAFT',
    "postedAt" TIMESTAMP(3),
    "postedById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelReason" TEXT,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "goods_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_issue_lines" (
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "serialId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "note" TEXT,

    CONSTRAINT "goods_issue_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" TEXT NOT NULL,
    "type" "MovementType" NOT NULL,
    "productId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "locationId" TEXT,
    "serialId" TEXT NOT NULL,
    "lot" TEXT,
    "quantity" DECIMAL(14,3) NOT NULL,
    "refType" TEXT NOT NULL,
    "refId" TEXT NOT NULL,
    "refLineId" TEXT,
    "refDocNo" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "goods_receipts_docNo_key" ON "goods_receipts"("docNo");

-- CreateIndex
CREATE INDEX "goods_receipts_status_docDate_idx" ON "goods_receipts"("status", "docDate");

-- CreateIndex
CREATE INDEX "goods_receipts_warehouseId_idx" ON "goods_receipts"("warehouseId");

-- CreateIndex
CREATE INDEX "goods_receipt_lines_receiptId_idx" ON "goods_receipt_lines"("receiptId");

-- CreateIndex
CREATE INDEX "goods_receipt_lines_productId_idx" ON "goods_receipt_lines"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "stock_serials_barcode_key" ON "stock_serials"("barcode");

-- CreateIndex
CREATE INDEX "stock_serials_receiptLineId_idx" ON "stock_serials"("receiptLineId");

-- CreateIndex
CREATE INDEX "stock_serials_productId_idx" ON "stock_serials"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "goods_issues_docNo_key" ON "goods_issues"("docNo");

-- CreateIndex
CREATE INDEX "goods_issues_status_docDate_idx" ON "goods_issues"("status", "docDate");

-- CreateIndex
CREATE INDEX "goods_issues_contactId_idx" ON "goods_issues"("contactId");

-- CreateIndex
CREATE INDEX "goods_issue_lines_serialId_idx" ON "goods_issue_lines"("serialId");

-- CreateIndex
CREATE UNIQUE INDEX "goods_issue_lines_issueId_serialId_key" ON "goods_issue_lines"("issueId", "serialId");

-- CreateIndex
CREATE INDEX "stock_movements_productId_idx" ON "stock_movements"("productId");

-- CreateIndex
CREATE INDEX "stock_movements_serialId_idx" ON "stock_movements"("serialId");

-- CreateIndex
CREATE INDEX "stock_movements_warehouseId_locationId_idx" ON "stock_movements"("warehouseId", "locationId");

-- CreateIndex
CREATE INDEX "stock_movements_refType_refId_idx" ON "stock_movements"("refType", "refId");

-- CreateIndex
CREATE INDEX "stock_movements_occurredAt_idx" ON "stock_movements"("occurredAt");

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "stock_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_postedById_fkey" FOREIGN KEY ("postedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "goods_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "stock_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_serials" ADD CONSTRAINT "stock_serials_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_serials" ADD CONSTRAINT "stock_serials_receiptLineId_fkey" FOREIGN KEY ("receiptLineId") REFERENCES "goods_receipt_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_serials" ADD CONSTRAINT "stock_serials_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "stock_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_serials" ADD CONSTRAINT "stock_serials_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "stock_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_issues" ADD CONSTRAINT "goods_issues_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_issues" ADD CONSTRAINT "goods_issues_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_issues" ADD CONSTRAINT "goods_issues_postedById_fkey" FOREIGN KEY ("postedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_issues" ADD CONSTRAINT "goods_issues_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_issue_lines" ADD CONSTRAINT "goods_issue_lines_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "goods_issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_issue_lines" ADD CONSTRAINT "goods_issue_lines_serialId_fkey" FOREIGN KEY ("serialId") REFERENCES "stock_serials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_issue_lines" ADD CONSTRAINT "goods_issue_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "stock_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "stock_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_serialId_fkey" FOREIGN KEY ("serialId") REFERENCES "stock_serials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- กันข้อมูลผิดที่ระดับฐานข้อมูล
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_quantity_nonzero" CHECK ("quantity" <> 0);
ALTER TABLE "stock_serials" ADD CONSTRAINT "stock_serials_initial_qty_positive" CHECK ("initialQty" > 0);
ALTER TABLE "goods_issue_lines" ADD CONSTRAINT "goods_issue_lines_quantity_positive" CHECK ("quantity" > 0);

-- Stock ledger เป็น append-only: ห้าม UPDATE (DELETE อนุญาตเฉพาะสคริปต์ล้างข้อมูลทดสอบ)
CREATE OR REPLACE FUNCTION stock_movements_no_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'stock_movements is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "stock_movements_no_update" BEFORE UPDATE ON "stock_movements" FOR EACH ROW EXECUTE FUNCTION stock_movements_no_update();
