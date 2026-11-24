-- CreateEnum
CREATE TYPE "EntityType" AS ENUM ('JURISTIC', 'INDIVIDUAL');

-- CreateEnum
CREATE TYPE "ChannelType" AS ENUM ('PHONE', 'MOBILE', 'EMAIL', 'LINE', 'FACEBOOK', 'WEBSITE', 'FAX', 'OTHER');

-- CreateEnum
CREATE TYPE "LookupKind" AS ENUM ('CONTACT_SOURCE', 'CUSTOMER_BUSINESS_TYPE');

-- CreateTable
CREATE TABLE "contacts" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "isCustomer" BOOLEAN NOT NULL DEFAULT false,
    "isVendor" BOOLEAN NOT NULL DEFAULT false,
    "entityType" "EntityType" NOT NULL DEFAULT 'JURISTIC',
    "name" TEXT NOT NULL,
    "taxId" VARCHAR(13),
    "branch" TEXT,
    "sourceId" TEXT,
    "customerBusinessTypeId" TEXT,
    "photoKey" TEXT,
    "note" TEXT,
    "regAddress" TEXT,
    "regHouseNo" TEXT,
    "regMoo" TEXT,
    "regSoi" TEXT,
    "regRoad" TEXT,
    "regSubdistrict" TEXT,
    "regDistrict" TEXT,
    "regProvince" TEXT,
    "regPostalCode" VARCHAR(10),
    "regCountry" TEXT NOT NULL DEFAULT 'ไทย',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_addresses" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "label" TEXT,
    "recipient" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "houseNo" TEXT,
    "moo" TEXT,
    "soi" TEXT,
    "road" TEXT,
    "subdistrict" TEXT,
    "district" TEXT,
    "province" TEXT,
    "postalCode" VARCHAR(10),
    "country" TEXT NOT NULL DEFAULT 'ไทย',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "contact_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_channels" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "type" "ChannelType" NOT NULL,
    "value" TEXT NOT NULL,
    "note" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "contact_channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_persons" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "lineId" TEXT,
    "note" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "contact_persons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tags" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_tags" (
    "contactId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "contact_tags_pkey" PRIMARY KEY ("contactId","tagId")
);

-- CreateTable
CREATE TABLE "lookup_options" (
    "id" TEXT NOT NULL,
    "kind" "LookupKind" NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lookup_options_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "contacts_code_key" ON "contacts"("code");

-- CreateIndex
CREATE INDEX "contacts_isCustomer_deletedAt_idx" ON "contacts"("isCustomer", "deletedAt");

-- CreateIndex
CREATE INDEX "contacts_isVendor_deletedAt_idx" ON "contacts"("isVendor", "deletedAt");

-- CreateIndex
CREATE INDEX "contacts_name_idx" ON "contacts"("name");

-- CreateIndex
CREATE INDEX "contact_addresses_contactId_idx" ON "contact_addresses"("contactId");

-- CreateIndex
CREATE INDEX "contact_channels_contactId_idx" ON "contact_channels"("contactId");

-- CreateIndex
CREATE INDEX "contact_channels_value_idx" ON "contact_channels"("value");

-- CreateIndex
CREATE INDEX "contact_persons_contactId_idx" ON "contact_persons"("contactId");

-- CreateIndex
CREATE UNIQUE INDEX "tags_name_key" ON "tags"("name");

-- CreateIndex
CREATE INDEX "contact_tags_tagId_idx" ON "contact_tags"("tagId");

-- CreateIndex
CREATE UNIQUE INDEX "lookup_options_kind_label_key" ON "lookup_options"("kind", "label");

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "lookup_options"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_customerBusinessTypeId_fkey" FOREIGN KEY ("customerBusinessTypeId") REFERENCES "lookup_options"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_addresses" ADD CONSTRAINT "contact_addresses_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_channels" ADD CONSTRAINT "contact_channels_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_persons" ADD CONSTRAINT "contact_persons_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_tags" ADD CONSTRAINT "contact_tags_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_tags" ADD CONSTRAINT "contact_tags_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;
