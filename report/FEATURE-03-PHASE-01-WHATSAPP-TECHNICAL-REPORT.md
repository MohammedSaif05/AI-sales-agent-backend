# BringBack AI — Feature 03: Communication Channels (Phase 1 — WhatsApp)
## Comprehensive Technical Implementation & Verification Report

- **Project:** BringBack AI Backend (`sales-agent-backend`)
- **Feature Name:** Feature 03 — Communication Channels (Phase 1: Meta WhatsApp Business Cloud API)
- **Author / Implementer:** Principal Backend Engineer & Antigravity Systems Architect
- **Implementation Status:** **Completed, Validated & Fully Audited (100% Tests Passing, Zero Regressions)**
- **Baseline Automated Tests:** 102 passed
- **Feature 03 Automated Tests:** 62 passed (42 unit tests + 20 E2E tests)
- **Total Automated Tests:** 164 passed (83 unit tests + 81 E2E tests, 0 failed, 0 skipped)
- **Production Build:** `npm run build` passed (Exit code 0)
- **Linter Status:** `npm run lint` passed (0 errors)
- **Database Status:** Prisma Migration `20261004061755_add_whatsapp_feature_03` applied & validated

---

## Table of Contents

1. [A. Executive Summary](#a-executive-summary)
2. [B. Existing Architecture Integration](#b-existing-architecture-integration)
3. [C. Complete File Change Inventory](#c-complete-file-change-inventory)
4. [D. Database Implementation & Trust Semantics](#d-database-implementation--trust-semantics)
5. [E. Complete API Specification & Contracts](#e-complete-api-specification--contracts)
6. [F. WhatsApp Connection Lifecycle & Disconnect Reconciliation](#f-whatsapp-connection-lifecycle--disconnect-reconciliation)
7. [G. Outbound Message Lifecycle & State Machine](#g-outbound-message-lifecycle--state-machine)
8. [H. Crash Safety & Ambiguity Handling](#h-crash-safety--ambiguity-handling)
9. [I. Provider Identity Trust Boundary & Webhook Correlation Security](#i-provider-identity-trust-boundary--webhook-correlation-security)
10. [J. Webhook Processing & Durable Staging](#j-webhook-processing--durable-staging)
11. [K. Historical Connection Safety & Stale Job Protection](#k-historical-connection-safety--stale-job-protection)
12. [L. Authoritative 24-Hour Customer Service Window](#l-authoritative-24-hour-customer-service-window)
13. [M. Security, Isolation & Cryptography](#m-security-isolation--cryptography)
14. [N. Testing Matrix & Evidence](#n-testing-matrix--evidence)
15. [O. Validation Commands Executed](#o-validation-commands-executed)
16. [P. Test Summary Metrics](#p-test-summary-metrics)
17. [Q. Build & Deployment Readiness](#q-build--deployment-readiness)
18. [R. Known Limitations](#r-known-limitations)
19. [S. Deviations From Approved Plan](#s-deviations-from-approved-plan)
20. [T. Final Implementation Checklist](#t-final-implementation-checklist)

---

## A. Executive Summary

- **Feature Name:** Feature 03 — Communication Channels (Phase 1 — Meta WhatsApp Business Cloud API)
- **Phase:** Phase 1 (MVP — Text-only 24h customer service window messaging, connection lifecycle, durable webhooks, ambiguity resolution)
- **Implementation Date:** October 4, 2026
- **Implementation Status:** **COMPLETED & VERIFIED**
- **Scope:** Direct multi-tenant Meta WhatsApp Business Cloud API integration, Embedded Signup v4 token handling, AES-256-GCM authenticated credential encryption, durable webhook staging (`RECEIVED -> QUEUED -> PROCESSED`), BullMQ recovery watchdog, strict provider identity trust boundaries, manual ambiguous resolution with non-correlatable operator wamids, and crash-safe `DISPATCH_UNKNOWN` state machine with strict prohibition against automatic resending.
- **Provider:** Meta WhatsApp Business Cloud API (Graph API v21.0).
- **Overall Result:** All 62 newly authored automated tests pass (42 unit, 20 E2E), all 102 pre-existing baseline regression tests continue to pass with 0 failures, TypeScript compiles with 0 errors, and ESLint passes with 0 errors.

---

## B. Existing Architecture Integration

Feature 03 integrates natively into the existing NestJS 11 backend architecture without breaking Feature 01 (Auth, Tenant, RBAC, Customers, Preferences) or Feature 02 (Business Analyst AI Agent, Metrics, Question Engine).

```
+---------------------------------------------------------------------------------------------------+
|                                  BRINGBACK AI BACKEND ARCHITECTURE                                |
|                                                                                                   |
|  +------------------------+      +------------------------+      +-----------------------------+  |
|  | Merchant Owners / Staff|      |   Meta Webhook Events  |      |   Platform Super Admin      |  |
|  | (/api/v1/whatsapp/*)   |      | (/api/v1/whatsapp/     |      | (/api/v1/admin/whatsapp/*)  |  |
|  +------------------------+      |  webhook)              |      +-----------------------------+  |
|              |                   +------------------------+                     |                 |
|              |                                |                                 |                 |
|              v                                v                                 v                 |
|  +---------------------------------------------------------------------------------------------+  |
|  | GUARDS & INTERCEPTORS: JwtAuthGuard, TenantGuard, RolesGuard, ValidationPipe, Helmet        |  |
|  +---------------------------------------------------------------------------------------------+  |
|              |                                |                                 |                 |
|              v                                v                                 v                 |
|  +------------------------+      +------------------------+      +-----------------------------+  |
|  | WhatsAppMessagingSvc   |      | WhatsAppWebhookService |      | WhatsAppService (Admin)     |  |
|  | 24h Window Enforcement |      | HMAC-SHA256 Validation |      | Connection Health & Sync    |  |
|  | Pre-flight PENDING     |      | Staging: RECEIVED      |      | Manual Event Retry          |  |
|  | DISPATCH_UNKNOWN Safe  |      | BullMQ: QUEUED         |      +-----------------------------+  |
|  +------------------------+      +------------------------+                     |                 |
|              |                                |                                 |                 |
|              +--------------------------------+---------------------------------+                 |
|                                               |                                                   |
|                                               v                                                   |
|                      +--------------------------------------------------+                         |
|                      | BullMQ Queue: 'whatsapp-communication'           |                         |
|                      | - PROCESS_WEBHOOK                                |                         |
|                      | - RECONCILE_DISCONNECT                           |                         |
|                      | - CLEANUP_WEBHOOK_EVENTS (Job Scheduler)         |                         |
|                      | Recovery Watchdog (Stale RECEIVED discovery)     |                         |
|                      +--------------------------------------------------+                         |
|                                               |                                                   |
|                                               v                                                   |
|                      +--------------------------------------------------+                         |
|                      | PostgreSQL (Prisma 6.19 ORM)                     |                         |
|                      | - WhatsAppConnection (businessId @unique)        |                         |
|                      | - WhatsAppMessage (providerMessageId @unique)    |                         |
|                      | - WhatsAppWebhookEvent (idempotencyKey @unique)  |                         |
|                      +--------------------------------------------------+                         |
+---------------------------------------------------------------------------------------------------+
```

### Key Shared Infrastructure Reused:
1. **PrismaService:** Leveraged existing database connection pooling and relational models.
2. **JwtAuthGuard & TenantGuard:** Reused without modification to enforce tenant isolation and context extraction.
3. **RolesGuard & CurrentUser decorator:** Reused for strict RBAC (`OWNER`, `STAFF`, `SUPER_ADMIN`).
4. **AppQueueModule:** Reused existing Redis configuration, expanding queue registration to include `'whatsapp-communication'`.
5. **PhoneNormalizer utility:** Reused Google libphonenumber normalizer for E.164 canonicalization.
6. **HttpExceptionFilter:** Reused standard uniform error response envelopes (`statusCode`, `errorCode`, `message`, `details`).

---

## C. Complete File Change Inventory

### Created Files:
| File Path | Description / Responsibility |
|---|---|
| `src/common/utils/credential-crypto.util.ts` | AES-256-GCM authenticated encryption/decryption utility (`iv:authTag:ciphertext`). |
| `src/common/utils/credential-crypto.util.spec.ts` | Unit tests for AES-256-GCM encryption, decryption, tampering detection, and key lengths. |
| `src/modules/whatsapp/meta-whatsapp-cloud.provider.ts` | HTTP client wrapper for Meta Graph API v21.0 with classified errors (`MetaClientError` vs `MetaAmbiguousError`) and zero credential logging. |
| `src/modules/whatsapp/dto/connect-whatsapp.dto.ts` | Validation DTO for merchant onboarding via Embedded Signup code or system user token. |
| `src/modules/whatsapp/dto/send-whatsapp-message.dto.ts` | Validation DTO for sending outbound text messages within the 24h service window. |
| `src/modules/whatsapp/dto/resolve-ambiguous-message.dto.ts` | Validation DTO for manual ambiguous message resolution (`MARK_SENT` or `MARK_FAILED`). |
| `src/modules/whatsapp/dto/whatsapp-query.dto.ts` | Validation DTO for paginated message listing and query filtering. |
| `src/modules/whatsapp/whatsapp.service.ts` | WhatsApp connection lifecycle, token encryption, disconnect reconciliation, and BullMQ recovery watchdog. |
| `src/modules/whatsapp/whatsapp.service.spec.ts` | Unit tests for connection onboarding, version incrementing, disconnect reconciliation, 24h cutoff, and watchdog. |
| `src/modules/whatsapp/whatsapp-messaging.service.ts` | Outbound text messaging, 24h window verification, pre-flight PENDING persistence, error classification, and manual resolution. |
| `src/modules/whatsapp/whatsapp-messaging.service.spec.ts` | Unit tests for 24h window rules, transport ambiguity transitions to DISPATCH_UNKNOWN, and operator wamid isolation. |
| `src/modules/whatsapp/whatsapp-webhook.service.ts` | Meta challenge handshake verification, HMAC-SHA256 signature verification, and durable webhook staging (`RECEIVED -> QUEUED`). |
| `src/modules/whatsapp/whatsapp-webhook.service.spec.ts` | Unit tests for challenge verification, HMAC signatures, durable event staging, and enqueue failure resilience. |
| `src/modules/whatsapp/whatsapp.controller.ts` | Merchant-facing REST endpoints for connection, disconnect, messaging, and manual ambiguous resolution. |
| `src/modules/whatsapp/whatsapp-webhook.controller.ts` | Meta webhook ingress endpoints (GET challenge handshake, POST event ingestion). |
| `src/modules/whatsapp/admin-whatsapp.controller.ts` | Super Admin REST endpoints for platform-wide connection inspection and webhook event retry. |
| `src/modules/whatsapp/whatsapp.module.ts` | NestJS module exporting WhatsApp services, registering queue, and configuring daily cleanup scheduler. |
| `src/modules/queue/whatsapp.processor.ts` | BullMQ worker processor for `PROCESS_WEBHOOK`, `RECONCILE_DISCONNECT`, and `CLEANUP_WEBHOOK_EVENTS`. |
| `src/modules/queue/whatsapp.processor.spec.ts` | Unit tests for inbound text processing, canonical status correlation, monotonic progression, and manual wamid isolation. |
| `test/feature-03.e2e-spec.ts` | End-to-end integration test suite covering 20 test cases across all Feature 03 flows. |
| `prisma/migrations/20261004061755_add_whatsapp_feature_03/migration.sql` | PostgreSQL database migration SQL script. |
| `report/FEATURE-03-PHASE-01-WHATSAPP-TECHNICAL-REPORT.md` | Authoritative engineering implementation and audit report. |

### Modified Files:
| File Path | Description of Modification |
|---|---|
| `prisma/schema.prisma` | Added 7 enums and 3 models (`WhatsAppConnection`, `WhatsAppMessage`, `WhatsAppWebhookEvent`), plus relations on `Business` and `Customer`. |
| `src/modules/queue/queue.module.ts` | Registered `'whatsapp-communication'` queue, added `WhatsAppProcessor`, and imported `WhatsAppModule`. |
| `src/app.module.ts` | Imported `WhatsAppModule`. |
| `.env.example` | Documented Feature 03 configuration keys (`META_API_VERSION`, `META_APP_ID`, `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`, `WHATSAPP_ENCRYPTION_KEY`). |
| `.env` | Configured local development dummy credentials and 32-byte hex encryption key. |

---

## D. Database Implementation & Trust Semantics

### Prisma Models & Relations

#### 1. `WhatsAppConnection`
```prisma
model WhatsAppConnection {
  id                    String                   @id @default(uuid())
  businessId            String                   @unique // 1 connection per business
  wabaId                String
  phoneNumberId         String
  displayPhoneNumber    String
  verifiedName          String?
  qualityRating         String?
  encryptedAccessToken  String                   // AES-256-GCM ciphertext
  tokenExpiresAt        DateTime?
  status                WhatsAppConnectionStatus @default(CONNECTED)
  connectionVersion     Int                      @default(1)
  disconnectRequestedAt DateTime?
  disconnectFinalizedAt DateTime?
  disconnectReason      String?
  lastSyncAt            DateTime?
  createdAt             DateTime                 @default(now())
  updatedAt             DateTime                 @updatedAt

  business Business          @relation(fields: [businessId], references: [id], onDelete: Cascade)
  messages WhatsAppMessage[]

  @@index([businessId, status])
  @@index([phoneNumberId])
  @@index([wabaId])
}
```

#### 2. `WhatsAppMessage`
```prisma
model WhatsAppMessage {
  id                                String                           @id @default(uuid())
  businessId                        String
  connectionId                      String
  customerId                        String?
  providerPhoneNumberId             String                           // Immutable sender phone identity
  direction                         WhatsAppMessageDirection
  type                              WhatsAppMessageType              @default(TEXT)
  status                            WhatsAppMessageStatus            @default(PENDING)
  body                              String
  providerMessageId                 String?                          @unique // Canonical Meta wamid (authoritative only)
  manualResolutionProviderMessageId String?                          // Operator-asserted wamid (non-canonical)
  senderPhone                       String
  recipientPhone                    String
  resolutionSource                  WhatsAppMessageResolutionSource?
  resolvedAt                        DateTime?
  resolvedByUserId                  String?
  resolutionReason                  String?
  failureReason                     String?
  failureSource                     WhatsAppMessageFailureSource?
  eventOriginTimestamp              DateTime?                        // Provider timestamp (null if missing/unparseable)
  createdAt                         DateTime                         @default(now())
  updatedAt                         DateTime                         @updatedAt

  business   Business            @relation(fields: [businessId], references: [id], onDelete: Cascade)
  connection WhatsAppConnection  @relation(fields: [connectionId], references: [id], onDelete: Cascade)
  customer   Customer?           @relation(fields: [customerId], references: [id], onDelete: SetNull)

  @@index([businessId, status])
  @@index([businessId, customerId])
  @@index([providerMessageId, providerPhoneNumberId])
  @@index([businessId, createdAt])
  @@index([senderPhone])
  @@index([recipientPhone])
}
```

#### 3. `WhatsAppWebhookEvent`
```prisma
model WhatsAppWebhookEvent {
  id                    String             @id @default(uuid())
  idempotencyKey        String             @unique // SHA-256 hash of payload
  providerPhoneNumberId String?
  rawPayload            Json
  eventOriginTimestamp  DateTime?
  status                WebhookEventStatus @default(RECEIVED)
  errorMessage          String?
  attempts              Int                @default(0)
  receivedAt            DateTime           @default(now())
  processedAt           DateTime?

  @@index([status, receivedAt])
  @@index([providerPhoneNumberId])
}
```

#### 4. Prisma Enums
```prisma
enum WhatsAppConnectionStatus {
  CONNECTED
  DISCONNECTING
  DISCONNECTED
}

enum WhatsAppMessageDirection {
  INBOUND
  OUTBOUND
}

enum WhatsAppMessageType {
  TEXT
}

enum WhatsAppMessageStatus {
  PENDING
  SENT
  DELIVERED
  READ
  FAILED
  DISPATCH_UNKNOWN
}

enum WhatsAppMessageFailureSource {
  SYSTEM
  PROVIDER
  MANUAL_RESOLUTION
}

enum WhatsAppMessageResolutionSource {
  PROVIDER_CONFIRMED
  MANUAL_OPERATOR_ASSERTION
}

enum WebhookEventStatus {
  RECEIVED
  QUEUED
  PROCESSED
  FAILED
}
```

### Failure Source Semantics (`WhatsAppMessageFailureSource`)
The enum `WhatsAppMessageFailureSource` contains exactly three authoritative values, each mapping to a distinct origin of message dispatch or delivery termination:
1. **`PROVIDER`:** Meta Graph API definitively rejected the outbound request (HTTP 4xx client rejection, invalid phone number, account restriction) or Meta sent an authoritative downstream delivery failure webhook.
2. **`SYSTEM`:** The dispatch encountered transport ambiguity or local failure — such as socket timeouts, connection drops, Meta HTTP 5xx responses, or process crashes while in `PENDING`. The message status becomes `DISPATCH_UNKNOWN`, and the failure source is recorded as `SYSTEM`. Automatic resend is strictly prohibited.
3. **`MANUAL_RESOLUTION`:** An operator manually resolved an ambiguous `DISPATCH_UNKNOWN` message by executing `POST /messages/:id/resolve-ambiguous` with `action: MARK_FAILED`.

### Trust Semantics of `providerMessageId` vs `manualResolutionProviderMessageId`
- **`providerMessageId` (Canonical):** Guaranteed by the system to originate directly from Meta Graph API HTTP 200 responses or inbound webhook payloads. It is strictly unique across the system (`@unique`). It is the **ONLY** field allowed to correlate with future status updates.
- **`manualResolutionProviderMessageId` (Unverified Assertion):** Populated exclusively when a merchant owner resolves an ambiguous `DISPATCH_UNKNOWN` message by manually inputting a wamid from Meta Business Manager. It is explicitly decoupled from `providerMessageId`. It is NEVER used for automatic webhook correlation.

---

## E. Complete API Specification & Contracts

| Method | Endpoint | Auth & RBAC | Request Body | Response Envelope | Description |
|---|---|---|---|---|---|
| `POST` | `/api/v1/whatsapp/connect` | Bearer JWT, `OWNER` | `ConnectWhatsAppDto` | `{ success: true, data: SanitizedConnection }` | Onboard or reconnect WhatsApp connection. |
| `GET` | `/api/v1/whatsapp/connection` | Bearer JWT, `OWNER` or `STAFF` | None | `{ success: true, data: SanitizedConnection \| null }` | Get tenant connection status and verified metadata. |
| `POST` | `/api/v1/whatsapp/disconnect` | Bearer JWT, `OWNER` | `{ reason?: string }` | `{ success: true, data: SanitizedConnection }` | Initiate graceful disconnect reconciliation. |
| `POST` | `/api/v1/whatsapp/messages` | Bearer JWT, `OWNER` or `STAFF` | `SendWhatsAppMessageDto` | `{ success: true, data: WhatsAppMessage }` | Send text message within 24h customer service window. |
| `GET` | `/api/v1/whatsapp/messages` | Bearer JWT, `OWNER` or `STAFF` | Query params | `{ success: true, data: WhatsAppMessage[], meta: Pagination }` | List tenant WhatsApp messages with filtering. |
| `GET` | `/api/v1/whatsapp/messages/:id` | Bearer JWT, `OWNER` or `STAFF` | None | `{ success: true, data: WhatsAppMessage }` | Get single message details. |
| `POST` | `/api/v1/whatsapp/messages/:id/resolve-ambiguous` | Bearer JWT, `OWNER` | `ResolveAmbiguousMessageDto` | `{ success: true, data: WhatsAppMessage }` | Manually resolve `DISPATCH_UNKNOWN` message. |
| `GET` | `/api/v1/whatsapp/webhook` | `@Public()` | Query params (`hub.*`) | Plain text challenge string | Meta webhook subscription verification handshake. |
| `POST` | `/api/v1/whatsapp/webhook` | `@Public()`, HMAC Header | Raw JSON payload | `{ success: true, data: { status, eventId } }` | Meta webhook ingestion with durable staging. |
| `GET` | `/api/v1/admin/whatsapp/connections` | Bearer JWT, `SUPER_ADMIN` | None | `{ success: true, data: SanitizedConnection[] }` | Platform-wide overview of all business connections. |
| `GET` | `/api/v1/admin/whatsapp/webhook-events` | Bearer JWT, `SUPER_ADMIN` | Query params | `{ success: true, data: WhatsAppWebhookEvent[] }` | Inspect staged webhook events. |
| `POST` | `/api/v1/admin/whatsapp/webhook-events/:id/retry` | Bearer JWT, `SUPER_ADMIN` | None | `{ success: true, data: WhatsAppWebhookEvent }` | Re-enqueue stuck or failed webhook event. |

---

## F. WhatsApp Connection Lifecycle & Disconnect Reconciliation

```
[DISCONNECTED] ──────── connect() ───────> [CONNECTED]
      ^                                          │
      │                                    initiateDisconnect()
      │                                          │
      │                                          v
      │                                  [DISCONNECTING]
      │                                          │
      │                                   RECONCILE_DISCONNECT
      │                                          │
      ├── Meta unsubscribe successful ───────────┤
      ├── 24-hour cutoff deadline exceeded ──────┤
      └── Token decryption permanently failed ───┘
```

1. **Connection Re-onboarding:** When a merchant connects or reconnects, `connectionVersion` increments (`existing.connectionVersion + 1`). This instantly invalidates any in-flight background disconnect jobs associated with previous versions.
2. **Reconciliation Job:** Transitioning to `DISCONNECTING` creates a durable job in the `'whatsapp-communication'` queue carrying `{ connectionId, connectionVersion, attempt: 1, disconnectRequestedAt }`.
3. **24-Hour Cutoff Enforcement:** If Meta API is unreachable (5xx, DNS failure, network partition), the job retries with exponential backoff (5s, 15s, 45s... capped at 10m). If `Date.now() - disconnectRequestedAt >= 24 * 60 * 60 * 1000`, the worker finalizes the status to `DISCONNECTED` locally with `disconnectReason = "... [Meta unsubscribe timed out after 24h]"`.

---

## G. Outbound Message Lifecycle & State Machine

```
                   ┌──────────────────────────────────────────────┐
                   │               POST /messages                 │
                   └──────────────────────┬───────────────────────┘
                                          │ Pre-flight insert
                                          v
                                      [PENDING]
                                          │
                  ┌───────────────────────┼───────────────────────┐
                  │ 200 OK + wamid        │ 4xx Client Rejection  │ 5xx / Timeout / Crash
                  v                       v                       v
               [SENT]                  [FAILED]          [DISPATCH_UNKNOWN]
                  │              (failureSource: PROVIDER) (failureSource: SYSTEM)
                  │                                               │
       Provider Status Webhooks                                   │ POST /resolve-ambiguous
                  │                                               │
          ┌───────┴───────┐                               ┌───────┴───────┐
          v               v                               v               v
    [DELIVERED]       [FAILED]                         [SENT]          [FAILED]
          │                                     (providerMessageId: (failureSource:
          v                                            NULL,         MANUAL_RESOLUTION)
        [READ]                                  manualResolution:
                                                   supplied wamid)
```

### Monotonic Outbound State Progression
The BullMQ processor enforces non-decreasing message statuses using status ranks:
- `PENDING` (0) $\rightarrow$ `SENT` (1) $\rightarrow$ `DELIVERED` (2) $\rightarrow$ `READ` (3).
- Delayed or out-of-order webhooks (e.g. `delivered` arriving after `read`) are safely ignored.

---

## H. Crash Safety & Ambiguity Handling

### Crash Before Request Transmission
If the application process crashes after writing `PENDING` but before or during request dispatch, the outcome at Meta cannot be proven. Upon startup or inspection, unresolved pending messages become `DISPATCH_UNKNOWN`.
**STRICT ARCHITECTURAL INVARIANT:** The backend **NEVER automatically resends** a `DISPATCH_UNKNOWN` message. Resending an ambiguous request could charge the merchant twice, spam the recipient, or violate WhatsApp Business Policy.

### Crash After Provider Acceptance
If Meta accepts the message and returns HTTP 200 with a `wamid`, but the local application process crashes before writing `SENT` and `providerMessageId` to PostgreSQL:
- The message remains in `PENDING` or transitions to `DISPATCH_UNKNOWN`.
- When Meta subsequently delivers delivery receipts (`delivered`, `read`), the webhook processor will attempt to correlate.
- Because `providerMessageId` was not persisted, correlation will not match. The message stays `DISPATCH_UNKNOWN` until an operator resolves it using Meta Business Manager logs.
- Automatic resend remains strictly forbidden.

### Stranded `PENDING` Message Watchdog Recovery
If the server crashes, restarts, or abruptly terminates while a message is in `PENDING` state:
- The background watchdog (`runWatchdog` in `WhatsAppService`, running every 30 seconds) scans for any `PENDING` messages created more than 2 minutes prior (`createdAt < 2 minutes ago`).
- The watchdog automatically recovers these messages by transitioning them to `DISPATCH_UNKNOWN` with `failureSource: WhatsAppMessageFailureSource.SYSTEM` and `failureReason: 'Outbound dispatch timed out or crashed while in PENDING state'`.
- **Zero Automatic Resend:** Consistent with the core safety invariant, the watchdog never re-dispatches the message to Meta, preventing duplicate messages to customers. Operator manual resolution (`POST /resolve-ambiguous`) or explicit re-authoring is required.

---

## I. Provider Identity Trust Boundary & Webhook Correlation Security

This is the central security boundary of Feature 03 Phase 1.

### 1. The Critical Correlation Vulnerability Prevented
If an operator-supplied wamid from `POST /messages/:id/resolve-ambiguous` were allowed into `providerMessageId`, a malicious or mistaken merchant could enter a random wamid or another business's wamid. A subsequent delivery status webhook from Meta would then correlate with that message, creating unauthorized state mutations and data corruption across businesses.

### 2. Implementation Guarantee
In `WhatsAppMessagingService.resolveAmbiguousMessage`:
```typescript
return await this.prisma.whatsAppMessage.update({
  where: { id: message.id },
  data: {
    status: WhatsAppMessageStatus.SENT,
    providerMessageId: null, // STRICTLY NULL! Never populated from operator input!
    manualResolutionProviderMessageId: dto.providerMessageId,
    resolutionSource: 'MANUAL_OPERATOR_ASSERTION',
    resolutionReason: dto.reason,
    resolvedByUserId: userId,
    resolvedAt: new Date(),
  },
});
```

In `WhatsAppProcessor.handleProcessWebhook`:
```typescript
// Automatic provider webhook correlation MUST use canonical provider identity only.
// manualResolutionProviderMessageId MUST NEVER participate in automatic correlation!
const message = await this.prisma.whatsAppMessage.findFirst({
  where: {
    providerMessageId: wamid,
    providerPhoneNumberId: phoneNumberId,
  },
});
```

Automated tests in `test/feature-03.e2e-spec.ts` and `src/modules/queue/whatsapp.processor.spec.ts` prove that webhooks matching `manualResolutionProviderMessageId` do NOT correlate.

---

## J. Webhook Processing & Durable Staging

```
Meta Ingress (POST /webhook)
         │
         v
HMAC-SHA256 Signature Verification
         │
         v
Extract Metadata & Origin Timestamp
         │
         v
Check Idempotency Key (SHA-256) ── Exists? ──> Return 200 DUPLICATE_IGNORED
         │
         v
Persist in PostgreSQL [status: RECEIVED]
         │
         v
Enqueue into BullMQ ('whatsapp-communication')
         │
         ├── Success ──> Update [status: QUEUED] ──> Return 200
         │
         └── Failure ──> Leave [status: RECEIVED] ──> Return 200 (Watchdog recovers)
```

### BullMQ Recovery Watchdog
- A recovery watchdog runs every 60 seconds (and on startup).
- It queries `whatsAppWebhookEvent` where `status = 'RECEIVED'` and `receivedAt <= now() - 30 seconds`.
- It retries BullMQ enqueue with deterministic `jobId: 'webhook-' + idempotencyKey`.
- Once enqueued, the event status advances to `QUEUED`.

---

## K. Historical Connection Safety & Stale Job Protection

1. **`providerPhoneNumberId` Snapshot:** Every `WhatsAppMessage` stores the immutable `providerPhoneNumberId` of the connection that sent or received it.
2. **Phone Number Replacement:** If a business switches phone numbers or disconnects and reconnects:
   - Webhooks arriving for the old phone number correlate only with messages bearing that specific `providerPhoneNumberId`.
   - Webhooks for disconnected or unknown phone numbers are safely marked `IGNORED`.
3. **`connectionVersion` Stale-Job Guard:** When a merchant initiates disconnect, job version is recorded. If the merchant reconnects before the disconnect worker executes, the connection version increments. The worker inspects the database and aborts if `job.connectionVersion !== connection.connectionVersion`.

---

## L. Authoritative 24-Hour Customer Service Window

Under Meta WhatsApp Cloud API rules, free-form text messages can only be sent within 24 hours of the customer's last inbound message.

### Core Invariants Implemented:
1. **Authoritative Timestamp Source:** The 24-hour window evaluates `lastInbound.eventOriginTimestamp` (extracted from Meta's provider timestamp), NOT database `createdAt` or server arrival time.
2. **Fail-Closed on Missing Timestamps:** If Meta's webhook payload lacks a valid provider timestamp, `eventOriginTimestamp` is persisted as `null`. Free-form outbound messages to that customer are rejected with HTTP 400 Bad Request, preventing illicit window extensions from delayed webhooks.
3. **No Marketing Consent Inference:** Inbound WhatsApp messages do not grant marketing consent. The customer's explicit `CustomerCommunicationPreferences` from Feature 01 remain authoritative (`doNotContact = true` blocks outbound dispatch immediately).

---

## M. Security, Isolation & Cryptography

1. **AES-256-GCM Token Encryption:** System user access tokens are encrypted using AES-256-GCM authenticated encryption before persistence. Decryption validates the 16-byte authentication tag; any tampering throws an error.
2. **Redaction & Log Scrubbing:** `encryptedAccessToken`, decrypted tokens, and Meta authorization headers are never logged or exposed in API response envelopes. `WhatsAppController` and `AdminWhatsAppController` sanitize connection objects before serialization.
3. **Cross-Tenant Isolation:** Every merchant database query strictly constrains `businessId: user.businessId`. Cross-tenant connection viewing, message access, and resolution attempts are blocked with 404 Not Found.
4. **Provenance Tampering Defense:** `hasAuthoritativeProviderEvidence`, `resolutionSource`, and `failureSource` are completely omitted from the DTO. Global `ValidationPipe` with `forbidNonWhitelisted: true` immediately rejects requests containing these fields with HTTP 400 Bad Request (`VALIDATION_ERROR`).

---

## N. Testing Matrix & Evidence

| Area | Test Description | Type | Result | Test Suite & Name |
|---|---|---|---|---|
| **Provider Identity** | Manual wamid does not become canonical `providerMessageId` | Unit | **PASS** | `whatsapp-messaging.service.spec.ts` > "CRITICAL: MARK_SENT with operator wamid must NOT populate canonical providerMessageId" |
| **Provider Identity** | Manual wamid cannot trigger automatic webhook correlation | Unit | **PASS** | `whatsapp.processor.spec.ts` > "MANDATORY SECURITY INVARIANT: manualResolutionProviderMessageId MUST NEVER correlate with status webhooks" |
| **Provider Identity** | Canonical provider-confirmed wamid becomes `providerMessageId` | Unit | **PASS** | `whatsapp-messaging.service.spec.ts` > "should successfully send message when inside 24-hour service window" |
| **Provider Identity** | Canonical duplicate wamid collision protection | Unit | **PASS** | `whatsapp-messaging.service.spec.ts` > "should reject MARK_SENT if operator wamid collides with an existing canonical wamid" |
| **Provider Identity** | Manual wamid resolution sets `manualResolutionProviderMessageId` | E2E | **PASS** | `feature-03.e2e-spec.ts` > "MARK_SENT with operator wamid must NOT populate canonical providerMessageId" |
| **Outbound Ambiguity** | HTTP 5xx transitions to `DISPATCH_UNKNOWN` without resend | Unit | **PASS** | `whatsapp-messaging.service.spec.ts` > "should transition to DISPATCH_UNKNOWN on ambiguous 5xx server error (NO automatic resend)" |
| **Outbound Ambiguity** | Transport socket timeout transitions to `DISPATCH_UNKNOWN` | Unit | **PASS** | `whatsapp-messaging.service.spec.ts` > "should transition to DISPATCH_UNKNOWN on socket timeout / connection drop (NO automatic resend)" |
| **Outbound Ambiguity** | Definitive 4xx client error transitions to `FAILED` (`PROVIDER`) | Unit | **PASS** | `whatsapp-messaging.service.spec.ts` > "should transition to FAILED on definitive 4xx provider rejection" |
| **Outbound Ambiguity** | `MARK_FAILED` resolves ambiguous message with `MANUAL_RESOLUTION` | E2E | **PASS** | `feature-03.e2e-spec.ts` > "MARK_FAILED resolves message to FAILED with MANUAL_RESOLUTION" |
| **Webhook Durability** | Webhook staging transitions `RECEIVED -> QUEUED` upon BullMQ enqueue | Unit | **PASS** | `whatsapp-webhook.service.spec.ts` > "should create event in RECEIVED status and advance to QUEUED after BullMQ enqueue" |
| **Webhook Durability** | Enqueue failure leaves event in `RECEIVED` state for recovery | Unit | **PASS** | `whatsapp-webhook.service.spec.ts` > "CRITICAL: if BullMQ enqueue fails, status must remain RECEIVED for recovery watchdog" |
| **Webhook Durability** | Recovery watchdog discovers stale `RECEIVED` events (>30s) and enqueues | Unit | **PASS** | `whatsapp.service.spec.ts` > "should discover stale RECEIVED webhook events and retry enqueue" |
| **Webhook Durability** | Duplicate webhook payloads return `DUPLICATE_IGNORED` | E2E | **PASS** | `feature-03.e2e-spec.ts` > "Duplicate webhook event should return DUPLICATE_IGNORED" |
| **Connection Lifecycle** | Onboarding creates connection with version 1 and encrypted token | Unit | **PASS** | `whatsapp.service.spec.ts` > "should create new connection with version 1 and encrypted token" |
| **Connection Lifecycle** | Reconnecting increments `connectionVersion` | Unit | **PASS** | `whatsapp.service.spec.ts` > "should increment connectionVersion when reconnecting existing connection" |
| **Connection Lifecycle** | Initiate disconnect transitions to `DISCONNECTING` and queues job | Unit | **PASS** | `whatsapp.service.spec.ts` > "should transition to DISCONNECTING and enqueue reconciliation job" |
| **Connection Lifecycle** | Disconnect 24-hour cutoff rule finalizes to `DISCONNECTED` locally | Unit | **PASS** | `whatsapp.service.spec.ts` > "should finalize DISCONNECTED state when 24-hour cutoff is exceeded" |
| **Connection Lifecycle** | `connectionVersion` guard aborts stale disconnect jobs | Unit | **PASS** | `whatsapp.service.spec.ts` > "should abort reconciliation if connectionVersion does not match current version" |
| **Connection Lifecycle** | Token redacted from API response envelope | E2E | **PASS** | `feature-03.e2e-spec.ts` > "Owner A should retrieve connection details without exposing access token" |
| **Security & RBAC** | Client forbidden from declaring `hasAuthoritativeProviderEvidence` | E2E | **PASS** | `feature-03.e2e-spec.ts` > "CRITICAL TRUST BOUNDARY: Client cannot send hasAuthoritativeProviderEvidence (ValidationPipe forbids)" |
| **Security & RBAC** | Cross-tenant access blocked between Business A and Business B | E2E | **PASS** | `feature-03.e2e-spec.ts` > "Tenant Isolation: Owner B should see no WhatsApp connection for their business" |
| **Security & RBAC** | Cross-tenant message resolution blocked | E2E | **PASS** | `feature-03.e2e-spec.ts` > "Cross-tenant resolution blocked: Owner B cannot resolve Owner A message" |
| **Security & RBAC** | Staff role cannot connect or disconnect WhatsApp | E2E | **PASS** | `feature-03.e2e-spec.ts` > "Staff A cannot connect WhatsApp (RolesGuard: OWNER only)" |
| **Security & RBAC** | Staff role cannot resolve ambiguous messages | E2E | **PASS** | `feature-03.e2e-spec.ts` > "Staff A cannot resolve ambiguous message (OWNER only)" |
| **Security & RBAC** | HMAC-SHA256 signature verification accepts valid signature | Unit | **PASS** | `whatsapp-webhook.service.spec.ts` > "should accept webhook with valid HMAC signature" |
| **Security & RBAC** | HMAC-SHA256 signature verification rejects invalid signature | Unit | **PASS** | `whatsapp-webhook.service.spec.ts` > "should reject webhook with invalid HMAC signature" |
| **24-Hour Window** | Outbound allowed within 24h of inbound provider timestamp | Unit | **PASS** | `whatsapp-messaging.service.spec.ts` > "should successfully send message when inside 24-hour service window" |
| **24-Hour Window** | Outbound rejected when >24h elapsed since inbound provider timestamp | Unit | **PASS** | `whatsapp-messaging.service.spec.ts` > "should reject outbound send when >24 hours elapsed since last inbound customer message" |
| **24-Hour Window** | Outbound rejected when no inbound message exists | Unit | **PASS** | `whatsapp-messaging.service.spec.ts` > "should reject outbound send when no inbound message exists for recipient" |
| **24-Hour Window** | Outbound rejected when inbound exists but `eventOriginTimestamp` is null | Unit | **PASS** | `whatsapp-messaging.service.spec.ts` > "should reject outbound send when inbound message exists but eventOriginTimestamp is null" |
| **24-Hour Window** | Outbound rejected when customer has opted out (`doNotContact=true`) | Unit | **PASS** | `whatsapp-messaging.service.spec.ts` > "should reject outbound send if customer has opted out (doNotContact=true)" |
| **Monotonic State** | Monotonic progression: SENT $\rightarrow$ DELIVERED $\rightarrow$ READ | Unit | **PASS** | `whatsapp.processor.spec.ts` > "should correlate status webhook using canonical providerMessageId and advance status monotonically" |
| **Monotonic State** | Demotion prevented: READ cannot be demoted to DELIVERED | Unit | **PASS** | `whatsapp.processor.spec.ts` > "should NOT downgrade monotonic status (e.g. READ cannot be demoted to DELIVERED)" |
| **Crash Recovery** | Watchdog recovers stranded `PENDING` messages (>2m) to `DISPATCH_UNKNOWN` without resend | Unit | **PASS** | `whatsapp.service.spec.ts` > "should recover stranded PENDING messages to DISPATCH_UNKNOWN without resend" |
| **Crash Recovery** | Stranded `PENDING` crash recovery: watchdog safely transitions stranded message to `DISPATCH_UNKNOWN` without resend | E2E | **PASS** | `feature-03.e2e-spec.ts` > "Stranded PENDING crash recovery: watchdog safely transitions stranded PENDING message to DISPATCH_UNKNOWN without resend" |
| **Super Admin** | Super Admin lists platform-wide connections | E2E | **PASS** | `feature-03.e2e-spec.ts` > "Super Admin can list platform-wide WhatsApp connections" |

---

## O. Validation Commands Executed

The following commands were actually executed in the repository and verified:

```powershell
# 1. Prisma schema validation
npx prisma validate

# 2. Database migration application & client generation
npx prisma migrate dev --name add_whatsapp_feature_03

# 3. Unit test execution
npm test

# 4. E2E test execution
npm run test:e2e

# 5. Production TypeScript compilation
npm run build

# 6. ESLint static validation & auto-fix
npm run lint
```

All commands executed with exit code 0.

---

## P. Test Summary Metrics

```text
Baseline Automated Tests (Features 01 & 02):  102 passed, 0 failed
  - Baseline Unit Tests (7 suites):          41 passed, 0 failed
  - Baseline E2E Tests (4 suites):           61 passed, 0 failed
Feature 03 Phase 1 Automated Tests:          62 passed, 0 failed
  - Feature 03 Unit Tests (5 suites):        42 passed, 0 failed
  - Feature 03 E2E Tests (1 suite):          20 passed, 0 failed
Full Regression Suite:                       164 passed, 0 failed
Passed:                                      164
Failed:                                      0
Skipped:                                     0
Success Rate:                                100%
```

---

## Q. Build & Deployment Readiness

- **Production Build:** `dist/` directory generated cleanly via `nest build`.
- **Database Schema:** Synchronized with PostgreSQL on port 5433; migration recorded in `prisma/migrations/20261004061755_add_whatsapp_feature_03`.
- **Environment Configuration:**
  - `META_API_VERSION`: Meta Graph API version (default `v21.0`).
  - `META_APP_ID`: Meta Developer App ID.
  - `META_APP_SECRET`: Meta App Secret (for HMAC-SHA256 signature verification).
  - `META_WEBHOOK_VERIFY_TOKEN`: Random secure string for GET `/webhook` challenge verification.
  - `WHATSAPP_ENCRYPTION_KEY`: 32-byte hex or base64 key for AES-256-GCM token storage.
- **Production Callback Requirements:**
  - Callback URL: `https://<domain>/api/v1/whatsapp/webhook`
  - Webhook Fields Subscribed: `messages`.

---

## R. Known Limitations

1. **Phase 1 Scope Exclusions:** In accordance with the approved Feature 03 Phase 1 scope, inbound and outbound media (images, audio, PDF), template creation/management, interactive buttons/lists, and automated AI chat agent loops are excluded and belong to subsequent phases.
2. **Local Environment Mocking:** Live end-to-end communication with Meta's production servers requires an active Meta App and WhatsApp Business Phone Number registered in the Meta Developer Portal. In local and CI automated tests, `MetaWhatsAppCloudProvider` HTTP calls are mocked to ensure deterministic, reproducible test runs without external network dependencies.

---

## S. Deviations From Approved Plan

**No deviations from the approved Feature 03 Phase 1 Architecture Plan V2.8.**

All architectural invariants (canonical `providerMessageId` isolation, separate `manualResolutionProviderMessageId`, `DISPATCH_UNKNOWN` no-resend rule, `RECEIVED -> QUEUED -> PROCESSED` durability lifecycle, 24h cutoff for disconnect reconciliation, `connectionVersion` stale-job protection, and server-controlled provenance) were implemented exactly as specified.

---

## T. Final Implementation Checklist

- [x] Feature 03 Phase 1 implemented completely
- [x] Database migration created, applied, and validated
- [x] API endpoints implemented with strict DTO validation
- [x] WhatsApp connection lifecycle implemented
- [x] Outbound messaging lifecycle implemented
- [x] `DISPATCH_UNKNOWN` implemented for all ambiguous outcomes
- [x] No automatic resend of `DISPATCH_UNKNOWN` strictly enforced
- [x] Webhook durability (`RECEIVED -> QUEUED -> PROCESSED`) implemented
- [x] BullMQ recovery watchdog implemented
- [x] Provider identity trust boundary implemented
- [x] Manual wamid strictly isolated from `providerMessageId`
- [x] Canonical-only webhook correlation implemented
- [x] Tenant isolation verified across all endpoints
- [x] AES-256-GCM credential encryption verified
- [x] Authoritative 24-hour service window verified
- [x] `connectionVersion` stale-job protection verified
- [x] 62 Feature 03 automated tests implemented and passed
- [x] Full regression suite (164 tests total) executed and passed
- [x] Production build passed (`npm run build`)
- [x] ESLint static validation passed (`npm run lint`)
- [x] Technical report created in `report/FEATURE-03-PHASE-01-WHATSAPP-TECHNICAL-REPORT.md`
