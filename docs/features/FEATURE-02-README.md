# Feature 02: AI Business Analyst Agent

> **Status:** IMPLEMENTATION COMPLETE AND VERIFIED  
> **Active AI Model:** `gemini-3.1-flash-lite` (JSON Schema Structured Response Mode)  
> **Source of Truth:** PostgreSQL (Aggregations via Prisma & SQL GroupBy)

---

## Technical API Specification & Verification

### 1. API Endpoints

| Method | Endpoint | Auth | Description | Status Codes |
| :--- | :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/business-analyst/analysis` | Bearer | Generate business analysis synchronously or queue asynchronously via BullMQ | `201`, `202`, `400`, `404`, `409` |
| `GET` | `/api/v1/business-analyst/analysis/:id` | Bearer | Retrieve specific verified analysis report by ID (Tenant isolated) | `200`, `404` |
| `GET` | `/api/v1/business-analyst/analysis` | Bearer | Paginated analysis report history (Filter by `analysisType`, `status`) | `200` |
| `GET` | `/api/v1/business-analyst/summary` | Bearer | Fast cached trailing 30-day dashboard summary cards | `200` |
| `POST` | `/api/v1/business-analyst/questions` | Bearer | Ask natural-language business question (Grounded solely on backend facts) | `201`, `400`, `409` |
| `GET` | `/api/v1/business-analyst/questions` | Bearer | Paginated history of past business questions and verified answers | `200` |

---

### 2. Request & Response Examples

#### A. Generate Analysis (Synchronous)
- **`POST /api/v1/business-analyst/analysis`**
- **Headers:** `Authorization: Bearer <token>`, `Idempotency-Key: <key-128-chars>`
- **Request Body:**
```json
{
  "analysisType": "CUSTOMER_ANALYSIS",
  "periodFrom": "2026-08-01T00:00:00.000Z",
  "periodTo": "2026-08-31T00:00:00.000Z",
  "isAsync": false
}
```
- **Response (`201 Created`):**
```json
{
  "success": true,
  "data": {
    "id": "c1f728c3-4d8b-47e2-a0ef-1f81e3a101b2",
    "analysisType": "CUSTOMER_ANALYSIS",
    "status": "COMPLETED",
    "summary": "Customer base shows steady acquisition with strong WhatsApp marketing opt-in engagement.",
    "result": {
      "period": {
        "from": "2026-08-01T00:00:00.000Z",
        "to": "2026-08-31T00:00:00.000Z"
      },
      "metrics": [
        {
          "key": "totalActiveCustomers",
          "name": "Total Active Customers",
          "value": 150,
          "unit": "customers",
          "description": "Total non-deleted customers currently registered in store"
        },
        {
          "key": "newCustomersInPeriod",
          "name": "New Customers in Period",
          "value": 30,
          "unit": "customers"
        },
        {
          "key": "cohortExpansionRatePercentage",
          "name": "Cohort Expansion Rate",
          "value": 25.0,
          "unit": "%"
        },
        {
          "key": "acquisitionVelocity",
          "name": "Customer Acquisition Velocity",
          "value": 1.0,
          "unit": "customers/day"
        },
        {
          "key": "whatsappMarketingOptInPercentage",
          "name": "WhatsApp Marketing Opt-in",
          "value": 80.0,
          "unit": "%"
        },
        {
          "key": "doNotContactPercentage",
          "name": "Do Not Contact",
          "value": 5.0,
          "unit": "%"
        }
      ],
      "insights": [
        {
          "title": "Strong Customer Base",
          "description": "Store currently has 150 active customers registered.",
          "category": "CUSTOMER_ACQUISITION",
          "referencedMetricKey": "totalActiveCustomers",
          "referencedMetricValue": 150,
          "severity": "POSITIVE"
        }
      ],
      "recommendations": [
        {
          "title": "Leverage WhatsApp Channel",
          "action": "Prioritize upcoming festive offers through WhatsApp outreach.",
          "rationale": "WhatsApp opt-in rate stands at 80% among active customers.",
          "referencedMetricKey": "whatsappMarketingOptInPercentage",
          "referencedMetricValue": 80.0,
          "priority": "HIGH"
        }
      ],
      "dataLimitations": [
        "Sales transactions, orders, and revenue data are not yet integrated into the trusted database.",
        "Product catalog and SKU inventory data are not yet integrated.",
        "Marketing campaign execution metrics are not yet connected."
      ]
    },
    "createdAt": "2026-09-16T15:00:00.000Z",
    "completedAt": "2026-09-16T15:00:02.000Z"
  }
}
```

#### B. Generate Analysis (Asynchronous via BullMQ)
- **`POST /api/v1/business-analyst/analysis`** with `"isAsync": true`
- **Response (`202 Accepted`):**
```json
{
  "success": true,
  "data": {
    "id": "d2e839f4-5e9c-48f3-b1fe-2f92f4b202c3",
    "analysisType": "CUSTOMER_ANALYSIS",
    "status": "QUEUED",
    "message": "Analysis request has been queued for background processing. Poll status at /api/v1/business-analyst/analysis/d2e839f4-5e9c-48f3-b1fe-2f92f4b202c3"
  }
}
```

#### C. Ask Business Question
- **`POST /api/v1/business-analyst/questions`**
- **Request Body:**
```json
{
  "question": "What is our customer opt-in rate for WhatsApp marketing?"
}
```
- **Response (`201 Created`):**
```json
{
  "success": true,
  "data": {
    "id": "e3f940a5-6f0d-49a4-c2af-3a03a5c303d4",
    "question": "What is our customer opt-in rate for WhatsApp marketing?",
    "answer": "Your store currently has an 80% WhatsApp marketing opt-in rate among active customers (120 out of 150 active customers opted in, excluding DNC records).",
    "status": "COMPLETED",
    "dataLimitations": [
      "Sales transactions, orders, and revenue data are not yet integrated into the trusted database."
    ],
    "createdAt": "2026-09-16T15:01:00.000Z"
  }
}
```

---

### 3. Supported Customer Metrics & Semantics

| Metric Key | Description | Type / Unit |
| :--- | :--- | :--- |
| `totalActiveCustomers` | Total non-deleted customers for the business | `number` (count) |
| `baselineCustomers` | Customers created strictly before `periodFrom` | `number` (count) |
| `newCustomersInPeriod` | Customers created in `[periodFrom, periodTo)` | `number` (count) |
| `cohortExpansionRatePercentage` | `(newCustomersInPeriod / baselineCustomers) * 100` (`null` if baseline=0) | `number \| null` (%) |
| `acquisitionVelocity` | `newCustomersInPeriod / periodDurationInDays` | `number` (cust/day) |
| `whatsappMarketingOptInPercentage` | Percentage of active customers opted into WhatsApp | `number` (%) |
| `voiceMarketingOptInPercentage` | Percentage of active customers opted into Voice calls | `number` (%) |
| `emailMarketingOptInPercentage` | Percentage of active customers opted into Email | `number` (%) |
| `doNotContactPercentage` | Percentage of active customers with DNC enabled | `number` (%) |
| `effectiveWhatsappEligibleCount` | WhatsApp opted-in customers excluding DNC | `number` (count) |
| `effectiveVoiceEligibleCount` | Voice opted-in customers excluding DNC | `number` (count) |
| `effectiveEmailEligibleCount` | Email opted-in customers excluding DNC | `number` (count) |
| `genderDistribution` | Aggregated histogram: `{ MALE, FEMALE, OTHER, UNSPECIFIED }` | `Record<string, number>` |
| `acquisitionSourceDistribution` | Aggregated histogram: `{ MANUAL, CSV, EXCEL, IMAGE, IMPORT }` | `Record<string, number>` |

---

### 4. Idempotency & Conflict Guard
- **Header:** `Idempotency-Key` (Optional, 1-128 alphanumeric, `-`, `_`).
- **Composite Key:** Enforced via PostgreSQL composite unique index `@@unique([businessId, idempotencyKey])`.
- **Replay Behavior:**
  - Same Tenant + Same Key + Same Payload $\rightarrow$ Replays previous analysis record without re-running AI.
  - Same Tenant + Same Key + Different Payload $\rightarrow$ `409 Conflict` (`IDEMPOTENCY_KEY_REUSE_CONFLICT`).
  - Different Tenant + Same Key $\rightarrow$ Processed independently without collision.

---

### 5. Redis Caching & Invalidation
- **Summary Cache:** Key `tenant:{businessId}:analyst:summary`, TTL: 900 seconds.
- **Report Cache:** Key `tenant:{businessId}:analyst:report:{type}:{from}:{to}`, TTL: 900 seconds.
- **Invalidation:** Automatically triggered across all 8 customer mutation events:
  1. Customer creation (`CustomersService.create`)
  2. Customer update (`CustomersService.update`)
  3. Customer soft-deletion (`CustomersService.softDelete`)
  4. Customer restoration (`CustomersService.create` restore path)
  5. Bulk customer import confirmation (`CustomerImportsService.confirmImport`)
  6. Communication preferences update (`CustomersService.update`)
  7. Marketing channel opt-in/out toggles (`CustomersService.update`)
  8. Do-not-contact (DNC) flag toggles (`CustomersService.update`)

---

### 6. Stale Job Recovery Watchdog
- Registered in [BusinessAnalystService](file:///d:/AI-sales-agent-backend/src/modules/business-analyst/business-analyst.service.ts) via `OnModuleInit`.
- Executes on server startup and every 60 seconds in the background (`unref()` timer).
- Automatically marks jobs stuck in `PROCESSING` status for over 5 minutes (`updatedAt < now - 5m`) as `FAILED` with safe error text.

---

### 7. Future Ingestion Modules Integration (Sales, Products, Campaigns)
- Future modules connect directly to the existing typed collector interfaces:
  - `SalesAnalyticsCollector` $\rightarrow$ Connects to future Sales/Orders database tables.
  - `ProductAnalyticsCollector` $\rightarrow$ Connects to future Catalog/SKU inventory tables.
  - `CampaignAnalyticsCollector` $\rightarrow$ Connects to future Outreach/Campaign execution tables.
- Collectors currently return `isAvailable: false` with explicit, user-friendly `dataLimitations`.

---

# Original Requirements Specification

2. Objective
Build a secure and scalable backend module that allows an authenticated business owner to:

View business performance insights.
Analyze sales and revenue data.
Understand customer behavior.
Identify best-performing products.
Identify low-performing products.
Analyze campaign performance.
Detect sales trends.
Understand customer retention and repeat purchases.
Ask business-related questions using natural language.
Receive AI-generated explanations and recommendations.
Generate business reports.
View historical analysis results.

The AI agent must provide useful business insights without exposing data belonging to another business or tenant.

3. Important Development Rule
The coding agent must not start implementation immediately.
Before writing code, the agent must:

Inspect the existing backend repository.
Understand the current architecture.
Inspect existing modules, database schema, authentication, tenant handling, storage, queues, and AI integrations.
Identify reusable services and utilities.
Check whether sales, customers, products, campaigns, or analytics data already exists.
Prepare a detailed implementation plan.
Clearly list:

Files to be created.
Files to be modified.
Database changes.
API endpoints.
Service responsibilities.
AI workflow.
Queue/background job requirements.
Security considerations.
Testing strategy.
Potential risks.


Stop and wait for approval.

Implementation must begin only after the implementation plan is reviewed and approved.

4. Scope
4.1 Included
This feature includes:

Business analytics data aggregation.
Sales and revenue analysis.
Customer analytics.
Product performance analysis.
Campaign performance analysis.
AI-generated business insights.
Natural-language business questions.
Business recommendations.
Analysis history.
Report generation.
Background processing for expensive analysis.
Tenant-level data isolation.
API endpoints for the mobile application.
Proper validation, authorization, logging, and error handling.

4.2 Not Included
The following are outside the scope of this feature unless already required by the existing system:

Direct payment processing.
Accounting or tax filing.
Automatic bank account access.
Automatic business decision execution.
Sending WhatsApp messages.
Making voice calls.
Creating promotional posters.
Publishing campaigns to social media.
Editing business data without explicit user action.
Accessing data from another tenant.
Replacing a professional accountant or financial advisor.

The AI agent should provide insights and recommendations. It must not automatically execute high-impact business actions.

5. Expected User Flow
5.1 Open Business Analyst

Business owner logs into the mobile application.
User opens the Business Analyst feature.
Backend verifies the user identity.
Backend identifies the active business and tenant.
Backend loads the business data available for analysis.
Backend returns the latest analysis summary.

5.2 Generate New Analysis

User selects an analysis period.
User optionally selects an analysis type.
Backend validates the request.
Backend collects tenant-specific data.
Backend prepares an analytics dataset.
Backend sends a structured prompt to the configured AI provider.
AI provider returns structured insights.
Backend validates and sanitizes the AI response.
Backend stores the analysis result.
Backend returns the analysis status or result.

5.3 Ask a Business Question

User submits a natural-language question.
Backend verifies authentication and tenant access.
Backend determines which business data is relevant.
Backend retrieves only permitted tenant data.
Backend sends the required context to the AI provider.
AI provider generates an answer.
Backend validates the response.
Backend stores the question and answer if conversation history is supported.
Backend returns the answer to the mobile application.

5.4 View Historical Analysis

User opens analysis history.
Backend retrieves analysis records for the current business only.
Backend applies pagination and filters.
Backend returns historical reports and summaries.


6. Core Analysis Categories
The backend should support the following analysis categories.
6.1 Sales Analysis
Possible metrics:

Total sales.
Total revenue.
Number of orders.
Average order value.
Sales growth.
Daily sales.
Weekly sales.
Monthly sales.
Best-performing sales period.
Lowest-performing sales period.
Sales comparison between two periods.

6.2 Product Analysis
Possible insights:

Best-selling products.
Lowest-selling products.
Product revenue contribution.
Product quantity sold.
Product growth.
Products with declining sales.
Products with no recent sales.
Product category performance.
Product demand trends.

6.3 Customer Analysis
Possible insights:

Total customers.
New customers.
Returning customers.
Repeat purchase rate.
Customer purchase frequency.
Average customer spending.
Customer retention indicators.
Inactive customers.
High-value customer segments.
Customer growth trends.

6.4 Campaign Analysis
Possible metrics, depending on available campaign data:

Total campaigns.
Active campaigns.
Completed campaigns.
Campaign reach.
Campaign engagement.
Campaign conversions.
Campaign revenue.
Campaign cost.
Return on campaign investment.
Best-performing campaign.
Lowest-performing campaign.

If a metric is unavailable, the backend must not fabricate it. The response should clearly indicate that the required data is unavailable.
6.5 Business Trend Analysis
Possible insights:

Revenue growth or decline.
Seasonal trends.
Customer growth.
Product demand changes.
Campaign performance changes.
Sales spikes.
Sales drops.
Unusual business activity.
Potential business risks.
Possible opportunities.


7. AI Agent Responsibilities
The AI Business Analyst Agent should:

Understand the business context.
Analyze structured business data.
Identify important trends.
Explain insights in simple language.
Distinguish facts from assumptions.
Provide evidence-based recommendations.
Mention the relevant time period.
Clearly identify missing or incomplete data.
Avoid making unsupported claims.
Avoid fabricating metrics.
Avoid exposing internal database details.
Return responses in a predictable structured format.

The AI agent should not directly access the database. The backend must retrieve, filter, aggregate, and prepare the data before sending it to the AI provider.

8. AI Response Contract
The AI provider should be instructed to return structured JSON.
Suggested response structure:
{
  "summary": "Short overview of the business performance.",
  "period": {
    "from": "2026-01-01",
    "to": "2026-01-31"
  },
  "metrics": [
    {
      "name": "Total Revenue",
      "value": 125000,
      "unit": "INR",
      "changePercentage": 12.5,
      "trend": "up",
      "source": "sales"
    }
  ],
  "insights": [
    {
      "title": "Revenue increased",
      "description": "Revenue increased compared with the previous period.",
      "severity": "positive",
      "evidence": [
        "Revenue increased by 12.5 percent."
      ]
    }
  ],
  "recommendations": [
    {
      "title": "Promote high-performing products",
      "description": "Consider increasing visibility for products with strong sales.",
      "priority": "medium",
      "reason": "These products contribute significantly to revenue."
    }
  ],
  "dataLimitations": [
    "Campaign cost data was not available."
  ]
}

The exact schema must be finalized after inspecting the existing project conventions.
The backend must validate the AI response before returning or storing it.

9. Suggested Backend Architecture
The implementation should follow the existing backend architecture.
A possible module structure:
src/
├── modules/
│   └── business-analyst/
│       ├── business-analyst.module.ts
│       ├── business-analyst.controller.ts
│       ├── business-analyst.service.ts
│       ├── business-analyst.repository.ts
│       ├── business-analyst.types.ts
│       ├── dto/
│       │   ├── generate-analysis.dto.ts
│       │   ├── ask-business-question.dto.ts
│       │   ├── analysis-history-query.dto.ts
│       │   └── analysis-period.dto.ts
│       ├── services/
│       │   ├── analytics-data.service.ts
│       │   ├── sales-analysis.service.ts
│       │   ├── customer-analysis.service.ts
│       │   ├── product-analysis.service.ts
│       │   ├── campaign-analysis.service.ts
│       │   ├── ai-business-analyst.service.ts
│       │   ├── ai-response-validator.service.ts
│       │   └── business-report.service.ts
│       ├── prompts/
│       │   ├── business-summary.prompt.ts
│       │   ├── sales-analysis.prompt.ts
│       │   ├── customer-analysis.prompt.ts
│       │   └── business-question.prompt.ts
│       └── jobs/
│           └── business-analysis.job.ts

This is only a suggested structure. The coding agent must adapt it to the existing repository rather than blindly creating duplicate architecture.

10. Database Requirements
The coding agent must first inspect the current Prisma schema and existing database models.
If suitable models already exist, reuse them.
Possible new models may include:
10.1 BusinessAnalysis
Suggested fields:
id
tenantId
businessId
requestedByUserId
analysisType
periodFrom
periodTo
status
summary
resultJson
dataSnapshotJson
errorMessage
createdAt
updatedAt
completedAt

10.2 BusinessQuestion
Suggested fields:
id
tenantId
businessId
userId
question
answer
contextJson
status
createdAt
updatedAt

10.3 BusinessAnalysisJob
A separate job model may not be necessary if BullMQ or another queue already manages job state.
The implementation must determine whether queue state should be stored in Redis, PostgreSQL, or both.
Database Rules

Every business analysis record must belong to a tenant.
Every record must include the business identifier where applicable.
Tenant IDs must never be accepted blindly from the client.
Tenant context must be derived from authenticated user access.
Add indexes for common filtering fields.
Use appropriate JSON fields for structured AI output.
Avoid storing unnecessary sensitive business data.
Do not store raw AI prompts containing unnecessary private information.
Use migrations for schema changes.
Preserve existing naming and migration conventions.


11. API Requirements
The final routes must follow the existing API naming and versioning conventions.
Suggested endpoints:
11.1 Generate Analysis
POST /business-analyst/analysis

Request:
{
  "analysisType": "business-summary",
  "periodFrom": "2026-01-01",
  "periodTo": "2026-01-31"
}

Response for synchronous processing:
{
  "id": "analysis-id",
  "status": "completed",
  "result": {}
}

Response for asynchronous processing:
{
  "id": "analysis-id",
  "status": "queued"
}

11.2 Get Analysis
GET /business-analyst/analysis/:id

11.3 Get Analysis History
GET /business-analyst/analysis

Supported query parameters may include:
page
limit
analysisType
status
periodFrom
periodTo

11.4 Ask Business Question
POST /business-analyst/questions

Request:
{
  "question": "Which products performed best this month?"
}

11.5 Get Question History
GET /business-analyst/questions

11.6 Get Latest Summary
GET /business-analyst/summary

These endpoint names are provisional and must be aligned with the existing project conventions.

12. Authentication and Authorization
All Business Analyst endpoints must require authentication.
The backend must:

Validate the access token.
Identify the authenticated user.
Identify the user's active business.
Verify the user has access to that business.
Resolve the tenant from trusted server-side context.
Reject unauthorized business access.
Reject cross-tenant access.
Apply role-based permissions where applicable.

Possible roles:

Business owner.
Business manager.
Authorized staff member.
Super admin, only where explicitly required.

Super admin access must not automatically expose every business's sensitive data. Any cross-business analytics access must be explicitly authorized, audited, and limited to approved administrative use cases.

13. Tenant Isolation
Tenant isolation is mandatory.
The backend must ensure:

Every query is scoped by tenant.
Business IDs are checked against the authenticated user's tenant.
Analysis IDs cannot be used to access another tenant's records.
Question history is tenant-scoped.
Background jobs preserve tenant context.
Cached analytics data is tenant-scoped.
Redis keys include tenant and business identifiers where necessary.
Logs do not expose data from another tenant.
AI prompts contain only the current tenant's permitted data.

Never rely only on frontend filtering for tenant security.

14. Data Aggregation Layer
The backend should create a dedicated data aggregation layer before calling the AI provider.
This layer should:

Retrieve required data from existing services or repositories.
Apply tenant and business filters.
Apply the requested date range.
Aggregate raw records into useful metrics.
Remove unnecessary sensitive fields.
Normalize currencies and dates.
Handle missing values.
Produce a compact AI-ready data structure.
Include metadata describing the data period and source.
Return data limitations when required.

Example:
{
  "business": {
    "businessId": "business-id",
    "currency": "INR"
  },
  "period": {
    "from": "2026-01-01",
    "to": "2026-01-31"
  },
  "sales": {
    "totalRevenue": 125000,
    "orderCount": 340,
    "averageOrderValue": 367.64
  },
  "products": [],
  "customers": [],
  "campaigns": [],
  "dataLimitations": []
}


15. AI Provider Integration
The backend must reuse the existing AI integration service if one already exists.
The implementation must inspect:

Existing Gemini/OpenAI integration.
API key management.
Model configuration.
Prompt management.
Retry logic.
Timeout handling.
Token limits.
Response parsing.
Usage tracking.
Error handling.
Provider fallback support.

The AI provider must not be called directly from the controller.
Suggested flow:
Controller
   ↓
Business Analyst Service
   ↓
Analytics Data Service
   ↓
Tenant-Scoped Repositories
   ↓
AI Business Analyst Service
   ↓
Existing AI Provider Service
   ↓
AI Response Validator
   ↓
Database / Queue Result
   ↓
API Response


16. Background Processing
Business analysis may require background processing when:

The dataset is large.
Multiple analysis categories are requested.
AI processing takes longer than the API timeout.
Report generation is expensive.
Multiple analyses are requested simultaneously.

If BullMQ or another queue already exists, reuse it.
Suggested job flow:
Request received
   ↓
Create analysis record with QUEUED status
   ↓
Add job to analysis queue
   ↓
Worker loads tenant-scoped data
   ↓
Worker calls AI provider
   ↓
Validate AI response
   ↓
Save result
   ↓
Update status to COMPLETED

Possible statuses:
QUEUED
PROCESSING
COMPLETED
FAILED
CANCELLED

The worker must preserve:

Tenant ID.
Business ID.
User ID.
Analysis ID.
Analysis type.
Requested date range.


17. Validation Requirements
Validate:

Analysis type.
Date format.
Date range.
Maximum analysis period.
Question length.
Empty questions.
Unsupported analysis types.
Pagination values.
Maximum page size.
Invalid analysis IDs.
Unauthorized business IDs.
Duplicate or excessive requests.

The backend should prevent:

Extremely large date ranges without approval.
Excessive AI requests.
Prompt injection through business data.
Malicious or oversized questions.
Invalid JSON returned by the AI provider.


18. Rate Limiting and Usage Control
The feature must support reasonable usage protection.
Possible controls:

Per-user request limits.
Per-business request limits.
Daily AI analysis limits.
Queue concurrency limits.
Maximum question length.
Maximum analysis frequency.
AI token usage tracking.

If subscription plans or usage limits already exist, integrate with the existing billing or quota system.
Do not create a separate quota system if one already exists.

19. Error Handling
Use the existing backend error-handling conventions.
Possible errors:
UNAUTHORIZED
FORBIDDEN
BUSINESS_NOT_FOUND
ANALYSIS_NOT_FOUND
INVALID_DATE_RANGE
INVALID_ANALYSIS_TYPE
QUESTION_REQUIRED
QUESTION_TOO_LONG
AI_PROVIDER_ERROR
AI_RESPONSE_INVALID
ANALYSIS_FAILED
RATE_LIMIT_EXCEEDED
DATA_UNAVAILABLE

Errors returned to the client must be safe and understandable.
Do not expose:

API keys.
Internal stack traces.
Database queries.
Raw provider errors containing secrets.
Internal tenant identifiers unless required.
Sensitive business records.

All unexpected errors must be logged using the existing logging system.

20. AI Safety and Data Privacy
The implementation must:

Send only necessary data to the AI provider.
Avoid sending personally identifiable customer information unless required.
Prefer aggregated data over raw customer records.
Mask phone numbers, emails, addresses, and other sensitive values.
Never send passwords, tokens, API keys, or authentication data.
Prevent cross-tenant data leakage.
Validate AI-generated output.
Clearly identify assumptions.
Avoid presenting guesses as verified facts.
Avoid financial, legal, medical, or tax advice claims.
Include data limitations where appropriate.

The AI output should be treated as an analysis assistant's recommendation, not an authoritative business decision.

21. Caching
Caching may be used for:

Latest business summary.
Frequently requested date ranges.
Repeated business questions, only where safe.
Expensive analytics aggregation.

Cache keys must include appropriate tenant and business scope.
Example:
business-analyst:{tenantId}:{businessId}:{analysisType}:{periodFrom}:{periodTo}

Do not cache sensitive data globally.
Cache invalidation must be considered when:

New sales are created.
Orders are updated.
Products are updated.
Customers are updated.
Campaign data changes.

Reuse existing caching conventions if available.

22. Logging and Observability
Log important events such as:

Analysis requested.
Analysis queued.
Analysis started.
Analysis completed.
Analysis failed.
AI provider timeout.
AI provider failure.
Invalid AI response.
Unauthorized access attempt.
Rate-limit rejection.

Logs should include safe metadata:
analysisId
tenantId
businessId
userId
analysisType
status
duration
provider
model

Do not log:

Full customer records.
Full sensitive prompts.
API keys.
Authentication tokens.
Private business data unnecessarily.


23. Testing Requirements
The implementation must include tests for:
Unit Tests

Analytics aggregation.
Date-range filtering.
Sales calculations.
Customer calculations.
Product calculations.
Campaign calculations.
AI response validation.
Error mapping.
Tenant filtering.
Permission checks.

Integration Tests

Generate analysis.
Retrieve analysis.
Retrieve analysis history.
Ask business question.
Retrieve question history.
Queue processing.
Failed AI request.
Invalid AI response.
Database persistence.

Security Tests

User cannot access another business.
User cannot access another tenant.
Invalid analysis IDs are rejected.
Unauthorized roles are rejected.
Tenant context cannot be overridden by request payload.
Sensitive data is not included in AI payloads.

Edge Cases

No sales data.
No customer data.
No product data.
No campaign data.
Empty date range.
Very large date range.
AI provider timeout.
AI provider returns invalid JSON.
AI provider returns incomplete fields.
Duplicate requests.
Rate limit exceeded.


24. Acceptance Criteria
The feature is considered complete only when:

[ ] Authenticated users can request business analysis.
[ ] Analysis is scoped to the correct tenant and business.
[ ] Sales metrics are calculated correctly.
[ ] Customer metrics are calculated correctly where data exists.
[ ] Product metrics are calculated correctly where data exists.
[ ] Campaign metrics are calculated correctly where data exists.
[ ] AI-generated results follow a validated structure.
[ ] Missing data is clearly reported.
[ ] AI-generated metrics are not fabricated.
[ ] Analysis results are persisted.
[ ] Analysis history supports pagination.
[ ] Business questions can be submitted.
[ ] Question responses are tenant-scoped.
[ ] Background processing works if required.
[ ] Rate limits are enforced where applicable.
[ ] Errors follow backend conventions.
[ ] Sensitive data is protected.
[ ] Unit tests are added.
[ ] Integration tests are added.
[ ] Security tests are added.
[ ] Database migrations are created if required.
[ ] API documentation is updated.
[ ] No existing feature is broken.
[ ] The implementation is reviewed and verified.


25. Definition of Done
Before reporting completion, the coding agent must provide:

Summary of implemented functionality.
List of created files.
List of modified files.
Database changes.
API endpoint list.
AI provider changes.
Queue or background job changes.
Authentication and tenant-isolation details.
Environment variables added or changed.
Migration commands.
Test commands.
Test results.
Known limitations.
Future improvements.
Confirmation that no unrelated files were modified.


26. Environment Variables
The coding agent must inspect existing environment variables before adding new ones.
Potential configuration may include:
BUSINESS_ANALYST_ENABLED=true
BUSINESS_ANALYST_MAX_PERIOD_DAYS=365
BUSINESS_ANALYST_MAX_QUESTION_LENGTH=2000
BUSINESS_ANALYST_DAILY_LIMIT=50
BUSINESS_ANALYST_QUEUE_NAME=business-analysis

Do not add duplicate AI provider variables if the project already has centralized AI configuration.
All new environment variables must be:

Added to the appropriate example environment file.
Documented.
Validated.
Given safe defaults where possible.
Excluded from source control when sensitive.


27. Documentation Requirements
Update relevant documentation for:

API endpoints.
Request and response schemas.
Environment variables.
Queue workers.
Database migrations.
Local development setup.
Testing.
AI provider configuration.
Usage limits.
Known limitations.

Follow the existing documentation style of the repository.

28. Implementation Plan Required Before Coding
The coding agent must first return an implementation plan containing:
Repository Understanding

Existing backend framework.
Existing module structure.
Existing authentication flow.
Existing tenant architecture.
Existing business, customer, product, sales, and campaign models.
Existing AI provider integration.
Existing queue system.
Existing caching system.

Proposed Changes

New modules.
New services.
New controllers.
New DTOs.
New database models or fields.
New migrations.
New queues or jobs.
New environment variables.
New tests.
Documentation updates.

Risk Analysis

Data availability risks.
AI response reliability.
Large dataset handling.
Tenant-isolation risks.
Rate-limit risks.
Privacy risks.
Performance risks.

The agent must stop after presenting the plan and wait for explicit approval.

29. Final Instruction to the Coding Agent

Implement Feature 02: AI Business Analyst Agent according to this README.
Do not start coding immediately.
First inspect the existing backend repository and prepare a detailed implementation plan. Reuse existing architecture, services, authentication, tenant handling, AI integration, queue system, database conventions, and error-handling patterns wherever possible.
Do not create duplicate infrastructure unnecessarily.
Do not assume that sales, customer, product, or campaign models exist. Verify the repository first.
Do not trust tenant IDs or business IDs received directly from the client. Resolve access from authenticated server-side context.
Do not send unnecessary personal or sensitive data to the AI provider.
Do not fabricate unavailable metrics.
Return structured and validated AI responses.
After preparing the implementation plan, stop and wait for approval.
Only implement the feature after the plan is explicitly approved.
After implementation, run the required tests and provide a complete implementation summary.

