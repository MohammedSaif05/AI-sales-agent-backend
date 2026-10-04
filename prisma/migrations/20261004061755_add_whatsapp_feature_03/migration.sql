-- CreateEnum
CREATE TYPE "WhatsAppConnectionStatus" AS ENUM ('CONNECTED', 'DISCONNECTING', 'DISCONNECTED', 'FAILED');

-- CreateEnum
CREATE TYPE "WhatsAppMessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "WhatsAppMessageType" AS ENUM ('TEXT');

-- CreateEnum
CREATE TYPE "WhatsAppMessageStatus" AS ENUM ('PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'DISPATCH_UNKNOWN');

-- CreateEnum
CREATE TYPE "WhatsAppMessageFailureSource" AS ENUM ('SYSTEM', 'PROVIDER', 'MANUAL_RESOLUTION');

-- CreateEnum
CREATE TYPE "WhatsAppMessageResolutionSource" AS ENUM ('PROVIDER_CONFIRMED', 'MANUAL_OPERATOR_ASSERTION');

-- CreateEnum
CREATE TYPE "WebhookEventStatus" AS ENUM ('RECEIVED', 'QUEUED', 'PROCESSED', 'IGNORED', 'FAILED');

-- CreateTable
CREATE TABLE "WhatsAppConnection" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "wabaId" TEXT NOT NULL,
    "phoneNumberId" TEXT NOT NULL,
    "displayPhoneNumber" TEXT NOT NULL,
    "verifiedName" TEXT,
    "qualityRating" TEXT,
    "encryptedAccessToken" TEXT NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3),
    "status" "WhatsAppConnectionStatus" NOT NULL DEFAULT 'CONNECTED',
    "connectionVersion" INTEGER NOT NULL DEFAULT 1,
    "disconnectRequestedAt" TIMESTAMP(3),
    "disconnectFinalizedAt" TIMESTAMP(3),
    "disconnectReason" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppMessage" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "customerId" TEXT,
    "providerPhoneNumberId" TEXT NOT NULL,
    "direction" "WhatsAppMessageDirection" NOT NULL,
    "type" "WhatsAppMessageType" NOT NULL DEFAULT 'TEXT',
    "status" "WhatsAppMessageStatus" NOT NULL DEFAULT 'PENDING',
    "body" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "manualResolutionProviderMessageId" TEXT,
    "senderPhone" TEXT NOT NULL,
    "recipientPhone" TEXT NOT NULL,
    "resolutionSource" "WhatsAppMessageResolutionSource",
    "resolvedAt" TIMESTAMP(3),
    "resolvedByUserId" TEXT,
    "resolutionReason" TEXT,
    "failureReason" TEXT,
    "failureSource" "WhatsAppMessageFailureSource",
    "eventOriginTimestamp" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppWebhookEvent" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "providerPhoneNumberId" TEXT,
    "rawPayload" JSONB NOT NULL,
    "eventOriginTimestamp" TIMESTAMP(3),
    "status" "WebhookEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "errorMessage" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "WhatsAppWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppConnection_businessId_key" ON "WhatsAppConnection"("businessId");

-- CreateIndex
CREATE INDEX "WhatsAppConnection_businessId_status_idx" ON "WhatsAppConnection"("businessId", "status");

-- CreateIndex
CREATE INDEX "WhatsAppConnection_phoneNumberId_idx" ON "WhatsAppConnection"("phoneNumberId");

-- CreateIndex
CREATE INDEX "WhatsAppConnection_wabaId_idx" ON "WhatsAppConnection"("wabaId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppMessage_providerMessageId_key" ON "WhatsAppMessage"("providerMessageId");

-- CreateIndex
CREATE INDEX "WhatsAppMessage_businessId_status_idx" ON "WhatsAppMessage"("businessId", "status");

-- CreateIndex
CREATE INDEX "WhatsAppMessage_businessId_customerId_idx" ON "WhatsAppMessage"("businessId", "customerId");

-- CreateIndex
CREATE INDEX "WhatsAppMessage_providerMessageId_providerPhoneNumberId_idx" ON "WhatsAppMessage"("providerMessageId", "providerPhoneNumberId");

-- CreateIndex
CREATE INDEX "WhatsAppMessage_businessId_createdAt_idx" ON "WhatsAppMessage"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "WhatsAppMessage_senderPhone_idx" ON "WhatsAppMessage"("senderPhone");

-- CreateIndex
CREATE INDEX "WhatsAppMessage_recipientPhone_idx" ON "WhatsAppMessage"("recipientPhone");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppWebhookEvent_idempotencyKey_key" ON "WhatsAppWebhookEvent"("idempotencyKey");

-- CreateIndex
CREATE INDEX "WhatsAppWebhookEvent_status_receivedAt_idx" ON "WhatsAppWebhookEvent"("status", "receivedAt");

-- CreateIndex
CREATE INDEX "WhatsAppWebhookEvent_providerPhoneNumberId_idx" ON "WhatsAppWebhookEvent"("providerPhoneNumberId");

-- AddForeignKey
ALTER TABLE "WhatsAppConnection" ADD CONSTRAINT "WhatsAppConnection_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "WhatsAppConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
