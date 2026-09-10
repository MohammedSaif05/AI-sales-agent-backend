-- CreateEnum
CREATE TYPE "SystemRole" AS ENUM ('USER', 'SUPER_ADMIN');

-- CreateEnum
CREATE TYPE "BusinessRole" AS ENUM ('OWNER', 'STAFF');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'OTHER', 'UNSPECIFIED');

-- CreateEnum
CREATE TYPE "CustomerSource" AS ENUM ('MANUAL', 'CSV', 'EXCEL', 'IMAGE', 'IMPORT', 'WHATSAPP', 'CAMPAIGN');

-- CreateEnum
CREATE TYPE "FileCategory" AS ENUM ('LOGO', 'CUSTOMER_IMPORT');

-- CreateEnum
CREATE TYPE "ImportType" AS ENUM ('CSV', 'EXCEL', 'IMAGE');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('PENDING', 'PARSING', 'PREVIEW_READY', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ImportRowStatus" AS ENUM ('VALID', 'INVALID', 'DUPLICATE');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT,
    "systemRole" "SystemRole" NOT NULL DEFAULT 'USER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "deviceInfo" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "isRevoked" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Business" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'India',
    "pincode" TEXT NOT NULL,
    "logoKey" TEXT,
    "email" TEXT,
    "website" TEXT,
    "instagram" TEXT,
    "facebook" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Business_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessUser" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "BusinessRole" NOT NULL DEFAULT 'OWNER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessHours" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "openTime" TEXT,
    "closeTime" TEXT,
    "isClosed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "BusinessHours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rawPhone" TEXT NOT NULL,
    "normalizedPhone" TEXT NOT NULL,
    "email" TEXT,
    "gender" "Gender" DEFAULT 'UNSPECIFIED',
    "dob" TIMESTAMP(3),
    "address" TEXT,
    "city" TEXT,
    "source" "CustomerSource" NOT NULL DEFAULT 'MANUAL',
    "importId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerCommunicationPreferences" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "whatsappMarketing" BOOLEAN NOT NULL DEFAULT false,
    "voiceMarketing" BOOLEAN NOT NULL DEFAULT false,
    "emailMarketing" BOOLEAN NOT NULL DEFAULT false,
    "doNotContact" BOOLEAN NOT NULL DEFAULT false,
    "consentSource" TEXT DEFAULT 'ONBOARDING_NO_CONSENT',
    "consentTimestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerCommunicationPreferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FileUpload" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "category" "FileCategory" NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FileUpload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerImport" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "fileId" TEXT,
    "importType" "ImportType" NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'PENDING',
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "validRows" INTEGER NOT NULL DEFAULT 0,
    "invalidRows" INTEGER NOT NULL DEFAULT 0,
    "duplicateRows" INTEGER NOT NULL DEFAULT 0,
    "errorSummary" TEXT,
    "idempotencyKey" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "CustomerImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerImportRow" (
    "id" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "rawName" TEXT,
    "rawPhone" TEXT,
    "rawEmail" TEXT,
    "rawGender" TEXT,
    "rawDob" TEXT,
    "rawCity" TEXT,
    "rawAddress" TEXT,
    "normalizedName" TEXT,
    "normalizedPhone" TEXT,
    "normalizedEmail" TEXT,
    "normalizedGender" "Gender",
    "normalizedDob" TIMESTAMP(3),
    "normalizedCity" TEXT,
    "normalizedAddress" TEXT,
    "status" "ImportRowStatus" NOT NULL DEFAULT 'VALID',
    "validationErrors" JSONB,
    "isDuplicate" BOOLEAN NOT NULL DEFAULT false,
    "duplicateReason" TEXT,

    CONSTRAINT "CustomerImportRow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");
CREATE INDEX "User_phone_idx" ON "User"("phone");

-- CreateIndex
CREATE INDEX "UserSession_userId_idx" ON "UserSession"("userId");
CREATE INDEX "UserSession_expiresAt_idx" ON "UserSession"("expiresAt");

-- CreateIndex
CREATE INDEX "Business_phone_idx" ON "Business"("phone");

-- CreateIndex
CREATE INDEX "BusinessUser_userId_idx" ON "BusinessUser"("userId");
CREATE INDEX "BusinessUser_businessId_idx" ON "BusinessUser"("businessId");
CREATE UNIQUE INDEX "BusinessUser_businessId_userId_key" ON "BusinessUser"("businessId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessHours_businessId_dayOfWeek_key" ON "BusinessHours"("businessId", "dayOfWeek");

-- CreateIndex
CREATE INDEX "Customer_businessId_deletedAt_idx" ON "Customer"("businessId", "deletedAt");
CREATE INDEX "Customer_businessId_normalizedPhone_idx" ON "Customer"("businessId", "normalizedPhone");
CREATE INDEX "Customer_businessId_name_idx" ON "Customer"("businessId", "name");
CREATE INDEX "Customer_businessId_createdAt_idx" ON "Customer"("businessId", "createdAt");

-- Partial Unique Index for soft deletes: guarantees phone uniqueness per business while deletedAt is null
CREATE UNIQUE INDEX "customers_business_phone_active_idx" ON "Customer" ("businessId", "normalizedPhone") WHERE "deletedAt" IS NULL;

-- CreateIndex
CREATE UNIQUE INDEX "CustomerCommunicationPreferences_customerId_key" ON "CustomerCommunicationPreferences"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "FileUpload_storageKey_key" ON "FileUpload"("storageKey");
CREATE INDEX "FileUpload_businessId_idx" ON "FileUpload"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerImport_idempotencyKey_key" ON "CustomerImport"("idempotencyKey");
CREATE INDEX "CustomerImport_businessId_status_idx" ON "CustomerImport"("businessId", "status");
CREATE INDEX "CustomerImportRow_importId_status_idx" ON "CustomerImportRow"("importId", "status");

-- AddForeignKey
ALTER TABLE "UserSession" ADD CONSTRAINT "UserSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessUser" ADD CONSTRAINT "BusinessUser_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessUser" ADD CONSTRAINT "BusinessUser_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessHours" ADD CONSTRAINT "BusinessHours_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_importId_fkey" FOREIGN KEY ("importId") REFERENCES "CustomerImport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerCommunicationPreferences" ADD CONSTRAINT "CustomerCommunicationPreferences_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileUpload" ADD CONSTRAINT "FileUpload_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileUpload" ADD CONSTRAINT "FileUpload_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerImport" ADD CONSTRAINT "CustomerImport_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerImport" ADD CONSTRAINT "CustomerImport_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "FileUpload"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerImport" ADD CONSTRAINT "CustomerImport_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerImportRow" ADD CONSTRAINT "CustomerImportRow_importId_fkey" FOREIGN KEY ("importId") REFERENCES "CustomerImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
