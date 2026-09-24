# Bringback AI — Feature 02: AI Business Analyst Agent
## Comprehensive Technical Architecture & Engineering Documentation

- **Project:** Bringback AI Backend (`sales-agent-backend`)
- **Feature Name:** Feature 02 — AI Business Analyst Agent & Super Admin Analytics
- **Author / Architect:** Senior Backend Architect & Technical Documentation Engineer
- **Status:** **Implementation Complete, Audited & Verified (100% Tests Passing)**
- **Target Audience:** Backend Engineers, Mobile App Engineers, Frontend Engineers, DevOps

---

## Table of Contents

1. [Executive Summary & Core Architectural Philosophy](#1-executive-summary--core-architectural-philosophy)
2. [Database Schema & Migrations](#2-database-schema--migrations)
3. [Analytics Engine & Collector Subsystem](#3-analytics-engine--collector-subsystem)
4. [AI Integration & Grounding Pipeline](#4-ai-integration--grounding-pipeline)
5. [Idempotency, Queueing, Caching & Watchdog](#5-idempotency-queueing-caching--watchdog)
6. [Complete API Specification & Request/Response Contracts](#6-complete-api-specification--requestresponse-contracts)
   - [6.1 Merchant Owner APIs (`/api/v1/business-analyst/*`)](#61-merchant-owner-apis-apiv1business-analyst)
   - [6.2 Super Admin Cross-Tenant APIs (`/api/v1/admin/*`)](#62-super-admin-cross-tenant-apis-apiv1admin)
7. [Security, RBAC & Multi-Tenant Isolation](#7-security-rbac--multi-tenant-isolation)
8. [Automated Test Suites & Verification Matrix](#8-automated-test-suites--verification-matrix)
9. [Developer Setup, Troubleshooting & Operations](#9-developer-setup-troubleshooting--operations)

---

## 1. Executive Summary & Core Architectural Philosophy

Feature 02 introduces an automated **AI Business Analyst Agent** tailored for SMB clothing retailers in India. It enables retail store owners to view instant business performance summaries, generate in-depth cohort and marketing reachability analyses, and ask natural-language questions about their customer data.

```
+-----------------------------------------------------------------------------------+
|                           BRINGBACK AI CORE ARCHITECTURE                          |
|                                                                                   |
|  +-----------------------+     +------------------------+     +----------------+  |
|  | PostgreSQL (Database) | --> | Backend Fact Sheet     | --> | Google Gemini  |  |
|  | Single Source of Truth|     | Aggregation Collectors |     | 3.1 Flash Lite |  |
|  +-----------------------+     +------------------------+     +----------------+  |
|                                             |                          |          |
|                                             v                          v          |
|                                    +----------------------------------------+     |
|                                    | Backend AI Response Validator          |     |
|                                    | 1. Metric Allowlist Verification       |     |
|                                    | 2. Authoritative Value Overwrite       |     |
|                                    | 3. PII & Hallucination Discarding      |     |
|                                    +----------------------------------------+     |
|                                                         |                         |
|                                                         v                         |
|                                            +------------------------+             |
|                                            | Verified Result Output |             |
|                                            | (Persisted & Cached)   |             |
|                                            +------------------------+             |
+-----------------------------------------------------------------------------------+
```

### Core Engineering Invariants:
1. **PostgreSQL as Sole Source of Truth:** LLMs cannot perform reliable statistical calculations and are prone to hallucinations. All metrics (counts, growth rates, channel opt-ins, velocities) are calculated directly via SQL aggregation before invoking AI.
2. **Untrusted AI Output & Strict Grounding:** Gemini is treated as an untrusted copywriter. Its output is validated against a 23-key metric allowlist (`ALLOWED_METRIC_KEYS`). The backend overwrites all metric values in AI insights with authoritative values from the trusted fact sheet.
3. **Zero PII Exposure:** Customer names, phone numbers, and email addresses are stripped at the database boundary. Fact sheets, snapshots, prompts, Redis cache keys, and logs contain only aggregate statistics.
4. **Do-Not-Contact (DNC) Precedence:** Channel marketing eligibility (WhatsApp, Voice, Email) strictly enforces `doNotContact == false` at the query level.
5. **Multi-Tenant Server Isolation:** All operations are bound to `businessId`. Store owners cannot query or generate reports for other stores, and Super Admins query through explicit, validated cross-tenant routes.

---

## 2. Database Schema & Migrations

- **Migration Applied:** `prisma/migrations/20260916150913_add_business_analyst/migration.sql`
- **Database Engine:** PostgreSQL 16+

### 2.1 Enums

```prisma
enum AnalysisType {
  BUSINESS_SUMMARY
  CUSTOMER_ANALYSIS
  SALES_ANALYSIS
  PRODUCT_ANALYSIS
  CAMPAIGN_ANALYSIS
  TREND_ANALYSIS
}

enum AnalysisStatus {
  QUEUED
  PROCESSING
  COMPLETED
  FAILED
}

enum QuestionStatus {
  PROCESSING
  COMPLETED
  FAILED
}
```

### 2.2 Models

#### 1. `BusinessAnalysis`
Stores periodic analytical reports generated synchronously or asynchronously.

```prisma
model BusinessAnalysis {
  id                String         @id @default(uuid())
  businessId        String
  requestedByUserId String
  analysisType      AnalysisType
  periodFrom        DateTime
  periodTo          DateTime
  status            AnalysisStatus
  summary           String?
  resultJson        Json?          // Validated metrics, insights, recommendations
  dataSnapshotJson  Json           // Authoritative fact sheet at generation time
  idempotencyKey    String?
  requestHash       String?        // SHA-256 payload hash for conflict detection
  errorMessage      String?
  createdAt         DateTime       @default(now())
  updatedAt         DateTime       @updatedAt
  completedAt       DateTime?

  business    Business @relation("BusinessAnalyses", fields: [businessId], references: [id], onDelete: Cascade)
  requestedBy User     @relation("UserAnalyses", fields: [requestedByUserId], references: [id], onDelete: Restrict)

  @@unique([businessId, idempotencyKey])
  @@index([businessId, createdAt])
  @@index([businessId, analysisType])
  @@index([businessId, status])
}
```

#### 2. `BusinessQuestion`
Stores interactive natural-language questions and AI-generated answers.

```prisma
model BusinessQuestion {
  id             String         @id @default(uuid())
  businessId     String
  userId         String
  question       String
  answer         String?
  contextJson    Json?          // Snapshot of context used to answer
  status         QuestionStatus
  idempotencyKey String?
  requestHash    String?
  errorMessage   String?
  createdAt      DateTime       @default(now())
  updatedAt      DateTime       @updatedAt

  business Business @relation("BusinessQuestions", fields: [businessId], references: [id], onDelete: Cascade)
  user     User     @relation("UserQuestions", fields: [userId], references: [id], onDelete: Restrict)

  @@unique([businessId, idempotencyKey])
  @@index([businessId, createdAt])
  @@index([businessId, userId])
}
```

---

## 3. Analytics Engine & Collector Subsystem

The analytics engine uses a modular collector pattern orchestrated by `AnalyticsDataService` (`src/modules/business-analyst/services/analytics-data.service.ts`).

### 3.1 Collector Architecture (`IAnalyticsCollector<T>`)

Each domain collector implements:
```typescript
export interface IAnalyticsCollector<T> {
  collect(
    businessId: string,
    periodFrom: Date,
    periodTo: Date,
    timezone?: string,
    options?: CollectorOptions,
  ): Promise<CollectorResult<T>>;
}
```

### 3.2 Active Collector: `CustomerAnalyticsCollector`
Located at `src/modules/business-analyst/collectors/customer-analytics.collector.ts`. Performs 7 concurrent aggregate queries:

| Metric Key | Calculation / Source Query | Semantics & Edge Cases |
|---|---|---|
| `totalActiveCustomers` | `prisma.customer.count({ where: { businessId, deletedAt: null } })` | Total active customer profiles. |
| `baselineCustomers` | `prisma.customer.count({ where: { businessId, deletedAt: null, createdAt: { lt: periodFrom } } })` | Cohort base prior to period start. |
| `newCustomersInPeriod` | `prisma.customer.count({ where: { businessId, deletedAt: null, createdAt: { gte: periodFrom, lt: periodTo } } })` | Registrations within window. |
| `cohortExpansionRatePercentage` | `((newCustomersInPeriod / baselineCustomers) * 100).toFixed(2)` | If `baseline == 0` and `new > 0`, returns `null` with `expansionStatus = 'INITIAL_ONBOARDING'`. |
| `acquisitionVelocity` | `newCustomersInPeriod / durationDays` | Average customers acquired per calendar day. |
| `whatsappMarketingOptInPercentage` | `(rawWhatsappConsent / totalActive) * 100` | Opt-in rate over active directory. |
| `voiceMarketingOptInPercentage` | `(rawVoiceConsent / totalActive) * 100` | Voice opt-in rate. |
| `emailMarketingOptInPercentage` | `(rawEmailConsent / totalActive) * 100` | Email opt-in rate. |
| `doNotContactPercentage` | `(doNotContactCount / totalActive) * 100` | Opt-out rate. |
| `effectiveWhatsappEligibleCount` | `count({ whatsappMarketing: true, doNotContact: false })` | **DNC Precedence:** Excludes DNC customers. |
| `effectiveVoiceEligibleCount` | `count({ voiceMarketing: true, doNotContact: false })` | **DNC Precedence:** Excludes DNC customers. |
| `effectiveEmailEligibleCount` | `count({ emailMarketing: true, doNotContact: false })` | **DNC Precedence:** Excludes DNC customers. |
| `genderDistribution` | `prisma.customer.groupBy({ by: ['gender'], where: { businessId, deletedAt: null } })` | Grouped breakdown by gender enum. |
| `acquisitionSourceDistribution` | `prisma.customer.groupBy({ by: ['source'], where: { businessId, deletedAt: null } })` | Grouped breakdown by acquisition source. |

### 3.3 Future Domain Collectors (Modular Stubs)
To prepare for subsequent roadmap features without breaking current types:
- `SalesAnalyticsCollector`: Returns `isAvailable: false` with explicit data limitation note.
- `ProductAnalyticsCollector`: Returns `isAvailable: false` with explicit data limitation note.
- `CampaignAnalyticsCollector`: Returns `isAvailable: false` with explicit data limitation note.

---

## 4. AI Integration & Grounding Pipeline

### 4.1 Provider Configuration
- **File:** `src/modules/ai/providers/gemini.provider.ts`
- **SDK:** `@google/genai` (Official Google Gen AI SDK)
- **Model:** `gemini-3.1-flash-lite` (Configurable via `GEMINI_MODEL` env var)
- **Output Mode:** JSON Schema Structured Output (`responseMimeType: 'application/json'`)

### 4.2 Strict Grounding System Instruction
The AI prompt enforces rigid grounding constraints:
```
You are the AI Business Analyst for Bringback AI.
Analyze the provided trusted backend Fact Sheet.
RULES:
1. Grounding: Rely ONLY on the numbers provided in the fact sheet metrics.
2. No Inventions: Do NOT fabricate percentages, revenue, or customer figures.
3. Allowlist: Every insight and recommendation MUST reference an exact metric key from the fact sheet.
4. Privacy: Never include customer PII.
```

### 4.3 Validation Service (`AiResponseValidatorService`)
Located at `src/modules/business-analyst/services/ai-response-validator.service.ts`:
1. **Allowlist Filter:** Checks every `referencedMetricKey` against `ALLOWED_METRIC_KEYS`. Any item referencing an unallowed key (or hallucinated metric) is dropped.
2. **Authoritative Overwrite:** Resolves the true numeric value from `metricValueMap` and sets `referencedMetricValue`. The AI cannot tamper with or miscalculate metric values.
3. **Sparse Cohort Fallback:** If zero insights or recommendations pass validation due to lack of store activity, a standardized limitation note is attached: `"Insufficient customer cohort activity during the selected period to generate insights or recommendations."`

---

## 5. Idempotency, Queueing, Caching & Watchdog

```
+--------------------------------------------------------------------------------------+
|                               ASYNCHRONOUS JOB LIFECYCLE                             |
|                                                                                      |
|  POST /analysis (isAsync=true)                                                       |
|        |                                                                             |
|        v                                                                             |
|  1. SHA-256 Hash Check ---> Idempotency Match? ---> [Return Existing Record]         |
|        |                                                                             |
|        v                                                                             |
|  2. Create BusinessAnalysis (Status: QUEUED)                                         |
|        |                                                                             |
|        v                                                                             |
|  3. Enqueue BullMQ Job ('business-analysis', attempts=3, exponential backoff)        |
|        |                                                                             |
|        v                                                                             |
|  4. Worker (BusinessAnalystProcessor) Processes Job:                                 |
|        - Status: PROCESSING                                                          |
|        - Gemini 3.1 Flash Lite Execution                                             |
|        - AiResponseValidatorService Validation & Overwrite                           |
|        - Status: COMPLETED (Persisted in DB & Cached in Redis)                       |
|                                                                                      |
|  [Watchdog Timer]: If job stuck in PROCESSING > 5 mins -> Automatically set FAILED    |
+--------------------------------------------------------------------------------------+
```

### 5.1 Composite Idempotency & Conflict Detection
- Clients provide an optional `Idempotency-Key` header (max 128 alphanumeric/dash/underscore chars).
- Backend computes a SHA-256 hash of the request payload (`endpoint`, `analysisType`, `periodFrom`, `periodTo`, `isAsync`).
- If an existing record matches the `(businessId, idempotencyKey)` composite key:
  - If payload hash matches $\rightarrow$ Returns the existing record immediately (`200/201`).
  - If payload hash differs $\rightarrow$ Throws `409 Conflict` (`IDEMPOTENCY_KEY_REUSE_CONFLICT`).
- Database race conditions are caught via Prisma error code `P2002` and resolved idempotently.

### 5.2 Background Queueing (`BullMQ`)
- **Queue Name:** `business-analysis`
- **Worker:** `BusinessAnalystProcessor` (`src/modules/business-analyst/business-analyst.processor.ts`)
- **Options:** `jobId: business-analysis:${businessId}:${record.id}`, `attempts: 3`, `backoff: { type: 'exponential', delay: 3000 }`, `removeOnComplete: true`.

### 5.3 Redis Caching & Invalidation
- **Summary Cache:** `tenant:${businessId}:analyst:summary` (TTL: 900s / 15 mins).
- **Report Cache:** `tenant:${businessId}:analyst:report:${type}:${from}:${to}` (TTL: 900s).
- **8-Path Mutation Invalidation (`AnalyticsCacheService`):**
  Cache is invalidated whenever:
  1. Customer is created manually (`CustomersService.create`)
  2. Customer is updated (`CustomersService.update`)
  3. Customer is soft-deleted (`CustomersService.softDelete`)
  4. Customer is restored from deletion (`CustomersService.create`)
  5. Bulk customer import is confirmed (`CustomerImportsService.confirmImport`)
  6. WhatsApp consent is toggled
  7. Voice consent is toggled
  8. Do-Not-Contact status is toggled

### 5.4 Stuck-Job Watchdog Recovery
- **Startup Recovery:** Runs immediately upon `onModuleInit()` to recover any jobs orphaned by a server restart.
- **Interval Watchdog:** Runs every 60 seconds (`watchdogTimer.unref()`).
- **Logic:** Queries `BusinessAnalysis` records where `status = PROCESSING` and `updatedAt < (now - 5 minutes)`. Automatically transitions them to `FAILED` with message: `"Analysis processing timed out and was recovered by watchdog."`

---

## 6. Complete API Specification & Request/Response Contracts

All responses follow the standard API envelope:
- **Success:** `{ "success": true, "data": ... }` (or `{ "success": true, "data": [...], "meta": { ... } }`)
- **Error:** `{ "success": false, "statusCode": 4xx/5xx, "errorCode": "...", "message": "...", "path": "..." }`

---

### 6.1 Merchant Owner APIs (`/api/v1/business-analyst/*`)
Guarded by `JwtAuthGuard`, `TenantGuard`, `RolesGuard` (`OWNER`, `STAFF`, `SUPER_ADMIN`). Business context is resolved automatically via `@CurrentBusinessId()`.

#### 1. Generate Business Analysis Report
- **Endpoint:** `POST /api/v1/business-analyst/analysis`
- **Headers:** `Authorization: Bearer <token>`, `Idempotency-Key: <opt-key>`
- **Request Body:**
  ```json
  {
    "analysisType": "CUSTOMER_ANALYSIS",
    "periodFrom": "2026-08-01T00:00:00.000Z",
    "periodTo": "2026-09-01T00:00:00.000Z",
    "isAsync": false
  }
  ```
- **Sync Response (`201 Created`):**
  ```json
  {
    "success": true,
    "data": {
      "id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
      "analysisType": "CUSTOMER_ANALYSIS",
      "status": "COMPLETED",
      "summary": "During August 2026, your store acquired 45 new customers with strong WhatsApp opt-in engagement.",
      "result": {
        "period": {
          "from": "2026-08-01T00:00:00.000Z",
          "to": "2026-09-01T00:00:00.000Z"
        },
        "metrics": [
          {
            "key": "totalActiveCustomers",
            "name": "Total Active Customers",
            "value": 150,
            "unit": "count",
            "description": "Total non-deleted registered customer profiles in store directory"
          },
          {
            "key": "cohortExpansionRatePercentage",
            "name": "Cohort Expansion Rate",
            "value": 42.86,
            "unit": "%",
            "description": "Active customer base relative growth over baseline registrations"
          }
        ],
        "insights": [
          {
            "title": "Strong WhatsApp Reachability",
            "description": "80% of active customers are reachable via WhatsApp marketing.",
            "category": "CUSTOMER_ACQUISITION",
            "referencedMetricKey": "whatsappMarketingOptInPercentage",
            "referencedMetricValue": 80.0,
            "severity": "POSITIVE"
          }
        ],
        "recommendations": [
          {
            "title": "Broadcast Festive Catalog",
            "action": "Dispatch seasonal lookbook to opted-in WhatsApp cohort.",
            "rationale": "High direct reachability ensures optimal broadcast ROI.",
            "referencedMetricKey": "effectiveWhatsappEligibleCount",
            "referencedMetricValue": 120,
            "priority": "HIGH"
          }
        ],
        "dataLimitations": [
          "Sales transactions, orders, and revenue data are not yet integrated into the trusted database."
        ]
      },
      "errorMessage": null,
      "createdAt": "2026-09-16T12:00:00.000Z",
      "completedAt": "2026-09-16T12:00:04.000Z"
    }
  }
  ```
- **Async Response (`202 Accepted`):**
  ```json
  {
    "success": true,
    "data": {
      "id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
      "analysisType": "CUSTOMER_ANALYSIS",
      "status": "QUEUED",
      "message": "Analysis request queued for background processing"
    }
  }
  ```

#### 2. Get Latest Business Summary (Cached)
- **Endpoint:** `GET /api/v1/business-analyst/summary`
- **Response (`200 OK`):** Returns trailing 30-day performance summary, metrics, insights, and recommendations cached in Redis.

#### 3. Get Specific Analysis Report
- **Endpoint:** `GET /api/v1/business-analyst/analysis/:id`
- **Response (`200 OK`):** Returns full analysis report. Includes stuck-job recovery check.

#### 4. List Historical Analyses (Paginated)
- **Endpoint:** `GET /api/v1/business-analyst/analysis?page=1&limit=10&status=COMPLETED`
- **Response (`200 OK`):**
  ```json
  {
    "success": true,
    "data": [ ... ],
    "meta": {
      "total": 12,
      "page": 1,
      "limit": 10,
      "totalPages": 2,
      "hasNextPage": true
    }
  }
  ```

#### 5. Ask Interactive Business Question
- **Endpoint:** `POST /api/v1/business-analyst/questions`
- **Request Body:**
  ```json
  {
    "question": "How many customers are eligible for WhatsApp outreach?"
  }
  ```
- **Response (`201 Created`):**
  ```json
  {
    "success": true,
    "data": {
      "id": "3b29c54e-9d22-48df-9f37-124b6111a43a",
      "question": "How many customers are eligible for WhatsApp outreach?",
      "answer": "Based on current analytics, your store has 120 customers opted into WhatsApp marketing who have not enabled Do-Not-Contact.",
      "status": "COMPLETED",
      "dataLimitations": [],
      "createdAt": "2026-09-16T14:30:00.000Z"
    }
  }
  ```

#### 6. List Question History (Paginated)
- **Endpoint:** `GET /api/v1/business-analyst/questions?page=1&limit=20`
- **Response (`200 OK`):** Paginated list of past inquiries and answers.

---

### 6.2 Super Admin Cross-Tenant APIs (`/api/v1/admin/*`)
Guarded by `JwtAuthGuard` and `RolesGuard(SystemRole.SUPER_ADMIN)`. Operates cross-tenant via `:id` (`businessId`) parameter.

| Method | Full API Route | Purpose | Error Codes |
|---|---|---|---|
| `GET` | `/api/v1/admin/businesses/:id/analyst-summary` | Inspect 30-day analytics summary, verified metrics, insights, and recommendations for target store. | `404 BUSINESS_NOT_FOUND` |
| `GET` | `/api/v1/admin/businesses/:id/analyses` | List paginated historical analysis reports for target store. | `404 BUSINESS_NOT_FOUND` |
| `GET` | `/api/v1/admin/businesses/:id/analyses/:analysisId` | Deep inspection of specific analysis report with dual-identifier composite ownership check. | `404 BUSINESS_NOT_FOUND`<br>`404 ANALYSIS_NOT_FOUND` |
| `GET` | `/api/v1/admin/businesses/:id/questions` | List paginated natural-language questions and answers for target store. | `404 BUSINESS_NOT_FOUND` |

---

## 7. Security, RBAC & Multi-Tenant Isolation

### 7.1 Multi-Tenant Guard Execution Flow

```
Incoming HTTP Request
       |
       v
+------------------+
| JwtAuthGuard     | ---> Invalid/Expired JWT? ---> 401 Unauthorized
+------------------+
       | (Valid JWT User: { userId, systemRole, businessId })
       v
+------------------+
| RolesGuard       | ---> User does not have required System/Business Role? ---> 403 Forbidden
+------------------+      (Super Admin systemRole automatically bypasses role restrictions)
       |
       v
+------------------+
| TenantGuard      | ---> If regular user & missing businessId ---> 403 Forbidden
+------------------+      (Super Admin systemRole bypasses fixed tenant requirement)
       |
       v
Controller Handler Execution:
- Owner Routes: Injects @CurrentBusinessId() (Extracts tenant from JWT)
- Admin Routes: Takes :id from route param & executes prisma.business.findUnique()
```

### 7.2 Strict Dual-Identifier Resource Ownership
In `AdminService` and `BusinessAnalystService`, resource retrieval enforces composite tenant verification:
```typescript
const record = await this.prisma.businessAnalysis.findFirst({
  where: { id: analysisId, businessId },
});
if (!record) {
  throw new NotFoundException({
    errorCode: 'ANALYSIS_NOT_FOUND',
    message: 'Business analysis record not found',
  });
}
```
Querying an analysis belonging to Business A via `/api/v1/admin/businesses/{businessBId}/analyses/{analysisAId}` returns a strict `404 ANALYSIS_NOT_FOUND`.

---

## 8. Automated Test Suites & Verification Matrix

### 8.1 Test Execution Results (Clean Run)

```
Test Suites: 7 passed, 7 total (Unit Tests: 41 passed)
Test Suites: 4 passed, 4 total (E2E Tests: 61 passed)
Overall Tests: 102 passed, 0 failed
Prisma Schema: Valid 🚀
TypeScript Compilation: 0 errors
```

### 8.2 Test Suites Breakdown

| Test Suite File | Type | Tests | Scope & Assertions |
|---|---|---|---|
| [`src/modules/business-analyst/business-analyst.service.spec.ts`](file:///d:/AI-sales-agent-backend/src/modules/business-analyst/business-analyst.service.spec.ts) | Unit | 12 | Metric calculation, allowlist filtering, value overwrite, SHA-256 conflict detection, watchdog recovery, DNC precedence. |
| [`src/modules/customers/customers.service.spec.ts`](file:///d:/AI-sales-agent-backend/src/modules/customers/customers.service.spec.ts) | Unit | 10 | Customer CRUD, phone normalizer, soft-delete, and cache invalidation integration. |
| [`src/modules/auth/auth.service.spec.ts`](file:///d:/AI-sales-agent-backend/src/modules/auth/auth.service.spec.ts) | Unit | 8 | Owner registration, multi-device sessions, Argon2 hashing, refresh token rotation. |
| [`src/common/guards/tenant.guard.spec.ts`](file:///d:/AI-sales-agent-backend/src/common/guards/tenant.guard.spec.ts) | Unit | 4 | Tenant enforcement and Super Admin bypass. |
| [`test/feature-02.e2e-spec.ts`](file:///d:/AI-sales-agent-backend/test/feature-02.e2e-spec.ts) | E2E | 16 | Owner Feature 02 flows (summary, sync analysis, BullMQ async analysis, Q&A assistant, idempotency, watchdog). |
| [`test/admin-analyst.e2e-spec.ts`](file:///d:/AI-sales-agent-backend/test/admin-analyst.e2e-spec.ts) | E2E | 17 | Super Admin Phase 1 flows (RBAC 403, 404 business checks, cross-tenant 404 isolation, summary inspection, zero PII checks). |
| [`test/feature-01.e2e-spec.ts`](file:///d:/AI-sales-agent-backend/test/feature-01.e2e-spec.ts) | E2E | 26 | Baseline Feature 01 flows (store onboarding, hours, customer CRUD, CSV/image imports). |
| [`test/app.e2e-spec.ts`](file:///d:/AI-sales-agent-backend/test/app.e2e-spec.ts) | E2E | 2 | Health check and system routes. |

---

## 9. Developer Setup, Troubleshooting & Operations

### 9.1 Environment Variables Checklist (`.env`)

```env
# Application
PORT=3000
NODE_ENV=development
API_PREFIX=api/v1
DEFAULT_TIMEZONE=Asia/Kolkata

# Database (PostgreSQL)
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/sales_agent_db?schema=public"

# Redis & Queue
REDIS_HOST=localhost
REDIS_PORT=6379
BUSINESS_ANALYST_CACHE_TTL=900

# Google Gemini AI
GEMINI_API_KEY="your-gemini-api-key"
GEMINI_MODEL=gemini-3.1-flash-lite

# Super Admin Seed
SUPER_ADMIN_PHONE=+918148387156
SUPER_ADMIN_PASSWORD=saif@2005
SUPER_ADMIN_NAME="Platform Administrator"
```

### 9.2 First-Time Setup & Fresh Clone Steps

```bash
# 1. Install dependencies
npm install

# 2. Generate Prisma Client types
npx prisma generate

# 3. Start local PostgreSQL & Redis via Docker
docker-compose up -d

# 4. Apply Database Migrations
npx prisma migrate dev

# 5. Seed Super Admin account
npm run seed

# 6. Run automated verification
npm test
npm run test:e2e

# 7. Start development server
npm run start:dev
```

### 9.3 Common Gotchas & Solutions

- **`TS2305: Module '@prisma/client' has no exported member 'AnalysisType'`:**
  *Cause:* Prisma client types not generated locally after pulling schema changes.
  *Fix:* Run `npx prisma generate`.
- **`Redis connection refused on localhost:6379`:**
  *Cause:* Redis Docker container is not running.
  *Fix:* Run `docker-compose up -d sales_agent_redis`.
- **`409 IDEMPOTENCY_KEY_REUSE_CONFLICT`:**
  *Cause:* Reusing the same `Idempotency-Key` header with different date range or analysis parameters.
  *Fix:* Generate a fresh UUID for distinct analysis inquiries.
