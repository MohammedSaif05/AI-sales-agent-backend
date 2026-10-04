# BringBack AI — Feature 03 Phase 1: WhatsApp Communication Channel
## Backend Implementation Specification

**Project:** BringBack AI — SMB AI Sales Assistant SaaS  
**Feature:** Feature 03 — Communication Channels  
**Phase:** Phase 1 — WhatsApp Business Cloud API  
**Application:** Backend API  
**Backend:** NestJS + TypeScript  
**Database:** PostgreSQL + Prisma ORM  
**Queue/Cache:** Redis + BullMQ  
**Storage:** Cloudflare R2 where required by existing architecture  
**AI:** Gemini/OpenAI through the existing backend abstraction  
**WhatsApp Provider:** Meta WhatsApp Business Cloud API  
**API Base:** `/api/v1`  
**Architecture:** Multi-tenant SaaS  
**Status:** Specification / Planning Required

---

# 1. IMPORTANT CONTEXT

BringBack AI is a multi-tenant SaaS platform for SMBs. Each customer/business (tenant) must operate its own business data and communication channels.

Feature 01 established the business/tenant and customer-management foundation.

Feature 02 established the AI Business Analyst Agent and its tenant-scoped backend architecture.

Feature 03 introduces the communication-channel layer.

This document covers **only Feature 03 Phase 1: WhatsApp**.

The WhatsApp implementation must use the **official Meta WhatsApp Business Cloud API**.

Each BringBack AI business must be able to connect and manage its own WhatsApp Business assets. BringBack AI must never treat WhatsApp as one globally shared business account.

The backend is the source of truth for:

- WhatsApp connection state
- Tenant ownership
- WhatsApp Business Account information
- Phone number information
- Credentials/tokens
- Webhook configuration/state
- Incoming messages
- Outgoing messages
- Message processing status
- Provider identifiers
- Delivery/read/failure events
- Audit and operational information

The Owner Mobile App and Super Admin Dashboard must communicate only with the backend HTTP APIs. They must not directly access Meta credentials, PostgreSQL, Redis, or other infrastructure.

---

# 2. DEVELOPMENT WORKFLOW — MANDATORY

This README is a **requirements and implementation specification**.

The coding agent MUST NOT immediately start modifying production code.

The required workflow is:

```text
README
   ↓
Inspect existing backend repository
   ↓
Understand Feature 01 + Feature 02 implementation
   ↓
Identify reusable modules/services/entities/guards/utilities
   ↓
Create a detailed implementation plan
   ↓
STOP
   ↓
Human reviews and approves the plan
   ↓
Implement approved plan
   ↓
Run tests / lint / type-check / build
   ↓
Verify API behavior and tenant isolation
```

The coding agent must first inspect the actual repository.

Do not assume that a file, module, dependency, schema, utility, guard, service, or pattern exists merely because this README describes its intended responsibility.

Do not duplicate functionality already implemented in Feature 01 or Feature 02.

---

# 3. PRODUCT OVERVIEW

BringBack AI helps SMBs manage customer engagement and AI-powered sales workflows.

The current product foundation is:

```text
Feature 01
Business Onboarding & Customer Management
        ↓
Feature 02
AI Business Analyst Agent
        ↓
Feature 03
Communication Channels
        ↓
Future AI Sales / Communication Agents
```

Feature 03 provides the communication infrastructure that future agents will consume.

For Phase 1:

```text
BringBack AI Business
        ↓
Connect WhatsApp Business
        ↓
Meta WhatsApp Business Cloud API
        ↓
BringBack Backend
        ↓
Tenant-scoped communication data
        ↓
Future AI Agents
```

The purpose is not to build the complete WhatsApp AI chatbot or campaign engine in this phase.

The purpose is to establish a reliable, secure, multi-tenant WhatsApp communication channel.

---

# 4. FEATURE 03 STRUCTURE

Feature 03 is divided into channel-specific phases.

```text
FEATURE 03 — COMMUNICATION CHANNELS
│
├── Phase 1 — WhatsApp
│   └── Meta WhatsApp Business Cloud API
│
├── Phase 2 — Email
│   └── Business Email Integration
│
└── Phase 3 — Voice
    └── Voice / Telephony Integration
```

This README covers **Phase 1 only**.

Phase 2 and Phase 3 must not be implemented as part of this task.

---

# 5. PHASE 1 OBJECTIVE

Build the backend foundation required for a BringBack AI business to connect and use its own WhatsApp Business Cloud API integration.

The backend must support:

1. WhatsApp Business connection setup
2. Tenant-scoped WhatsApp configuration
3. Meta WhatsApp Business Account identification
4. WhatsApp phone number identification
5. Secure credential/token management
6. Connection status management
7. Webhook verification
8. Incoming webhook event reception
9. Incoming message persistence
10. Outgoing WhatsApp message support
11. Message status event processing
12. Provider message ID tracking
13. Idempotent webhook processing
14. Tenant-safe access
15. Operational logging
16. Error handling
17. Retry-safe processing where applicable
18. APIs required by the Owner Mobile App
19. APIs required by the Super Admin Dashboard
20. Automated tests

The implementation must be production-oriented.

---

# 6. ARCHITECTURAL PRINCIPLES

## 6.1 Multi-tenancy

Every WhatsApp connection belongs to exactly one BringBack AI business/tenant.

The backend must derive the tenant from the authenticated user/session and existing tenant infrastructure.

A user must never be able to:

- Read another tenant's WhatsApp connection
- Modify another tenant's WhatsApp connection
- Read another tenant's messages
- Send messages using another tenant's WhatsApp credentials
- Trigger another tenant's webhook-related operations

Do not trust a tenant ID supplied by the frontend when the authenticated backend context already determines the tenant.

---

## 6.2 Backend as the source of truth

The mobile app and dashboard must not directly communicate with Meta for operational WhatsApp actions.

Correct:

```text
Mobile App
    ↓
BringBack Backend
    ↓
Meta Cloud API
```

Incorrect:

```text
Mobile App
    ↓
Meta Cloud API
```

This protects credentials and centralizes business rules.

---

## 6.3 Provider abstraction

Even though Meta is the provider for Phase 1, Meta-specific HTTP calls should not be scattered throughout unrelated business modules.

Prefer a provider boundary similar to:

```text
Communication / WhatsApp
        ↓
WhatsApp Provider Interface
        ↓
Meta WhatsApp Cloud Provider
        ↓
Meta Graph / WhatsApp Cloud API
```

The exact class/module naming must follow the existing repository architecture.

Do not introduce unnecessary abstraction layers if the existing project already has an established provider pattern.

---

## 6.4 Future-agent readiness

Feature 03 must provide reusable communication primitives for future features.

For example:

```text
AI Campaign Agent
        ↓
WhatsApp Communication Service
        ↓
Meta WhatsApp Provider
```

and:

```text
WhatsApp Incoming Message
        ↓
Communication Layer
        ↓
Future AI Agent
        ↓
WhatsApp Communication Service
        ↓
Meta WhatsApp Provider
```

Feature 03 must not contain the business logic of future AI agents.

---

# 7. WHATSAPP BUSINESS CLOUD API MODEL

The implementation must correctly distinguish the major Meta WhatsApp entities.

Conceptually:

```text
Meta Business
      │
      └── WhatsApp Business Account (WABA)
                │
                └── Phone Number
                         │
                         └── WhatsApp Cloud API
```

The backend must persist the identifiers necessary to associate a connected WhatsApp phone number with the correct BringBack AI tenant.

At minimum, the implementation should evaluate the need for:

- WABA ID
- Phone Number ID
- Business/Meta identifiers required by the selected onboarding flow
- Display phone number
- Provider/account status
- Access token or equivalent credential
- Token expiry information where applicable
- Webhook-related state
- Provider metadata

The coding agent must verify the current Meta API requirements during implementation rather than inventing fields.

---

# 8. CONNECTION / ONBOARDING

The backend must support a secure flow through which an authenticated business owner can connect their WhatsApp Business account.

The coding agent must inspect the current Meta-supported onboarding mechanism and determine the exact implementation required.

The implementation plan must explicitly document:

1. How the business starts WhatsApp connection
2. What Meta information is returned
3. How the backend validates that information
4. How the WhatsApp Business Account is identified
5. How the phone number is identified
6. How credentials are obtained
7. How credentials are securely persisted
8. How the connection is validated
9. How connection status is updated
10. How an existing connection is handled
11. How disconnect/reconnect works
12. What happens when Meta returns an error

Do not invent a custom OAuth flow if the current Meta onboarding mechanism provides a supported flow.

---

# 9. CREDENTIAL SECURITY

WhatsApp access tokens and other provider credentials are sensitive secrets.

They must never be:

- Returned in normal API responses
- Logged
- Exposed to the mobile app unnecessarily
- Exposed to the Super Admin UI unnecessarily
- Stored in plaintext if the architecture supports secure encryption
- Included in exception messages
- Included in analytics snapshots

The implementation plan must determine the appropriate secure storage mechanism based on the existing backend architecture.

Responses should expose safe information such as:

```text
connected: true
status: ACTIVE
displayPhoneNumber: ...
phoneNumberId: ...
wabaId: ...
```

but not the raw access token.

If encryption at rest is introduced, the implementation must define:

- Encryption mechanism
- Key source
- Rotation considerations
- Decryption boundary
- Failure behavior

Do not create a fake encryption system simply for the README.

---

# 10. CONNECTION STATUS

The backend should maintain a clear connection lifecycle.

A suitable conceptual state model may include:

```text
PENDING
CONNECTED / ACTIVE
DISCONNECTED
ERROR
```

The final enum names must follow the repository's conventions and the actual Meta integration requirements.

The backend must distinguish between:

- Connection exists
- Credentials exist
- Credentials are usable
- Phone number is available
- Provider is reachable
- Connection is operational

A database record existing must not automatically mean the channel is healthy.

---

# 11. WEBHOOK ARCHITECTURE

Meta WhatsApp Cloud API uses webhooks for incoming events.

The backend must provide a secure webhook endpoint capable of handling Meta verification and event delivery.

Conceptually:

```text
Meta
  ↓
Webhook
  ↓
BringBack Backend
  ↓
Validate event
  ↓
Identify WhatsApp account / phone number
  ↓
Resolve BringBack tenant
  ↓
Persist event/message
  ↓
Process asynchronously where appropriate
```

The webhook endpoint must not depend on an authenticated mobile/admin JWT because Meta is the caller.

The implementation must use the appropriate Meta webhook verification mechanism.

The agent must inspect current Meta documentation and implement the verification contract correctly.

---

# 12. WEBHOOK EVENT HANDLING

The backend should safely process relevant WhatsApp webhook events, including applicable:

- Incoming messages
- Message delivery status
- Message read status
- Message failure/error status
- Relevant account/phone-number events required by the integration

The implementation must distinguish between:

```text
Webhook received
        ↓
Event validated
        ↓
Event identified
        ↓
Tenant resolved
        ↓
Event persisted
        ↓
Processing completed
```

Webhook processing must be idempotent.

If Meta retries the same event, the backend must not create duplicate business messages or duplicate state transitions.

---

# 13. IDEMPOTENCY

Webhook delivery can be retried.

The backend must define an idempotency strategy using stable provider identifiers/event identifiers.

The implementation plan must identify:

- Which Meta identifier is used
- Where it is stored
- Which database constraint protects uniqueness
- What happens when a duplicate event arrives
- Whether duplicate events return success to Meta

The system must prefer safe duplicate handling over processing the same event multiple times.

---

# 14. MESSAGE DOMAIN

The backend should establish a durable internal representation of WhatsApp communication.

The exact Prisma models must be determined after repository inspection.

The design should evaluate entities such as:

```text
WhatsAppConnection
WhatsAppMessage
WhatsAppWebhookEvent
```

Potential message attributes include:

- Tenant/business ID
- WhatsApp connection ID
- Provider message ID
- Direction
- Sender
- Recipient
- Message type
- Text/content metadata
- Status
- Timestamp
- Provider payload metadata where justified
- Error information where applicable
- Created/updated timestamps

Do not blindly store complete raw Meta payloads if they contain unnecessary personal data.

The implementation must minimize stored PII and define retention considerations.

---

# 15. MESSAGE DIRECTION

The internal communication model should distinguish:

```text
INBOUND
```

for messages received from customers through WhatsApp, and:

```text
OUTBOUND
```

for messages sent by BringBack AI/business users/agents.

The final naming must follow existing repository conventions.

This distinction will be required by future AI agents and analytics.

---

# 16. OUTGOING MESSAGE ARCHITECTURE

The backend must provide a controlled service for sending WhatsApp messages.

Conceptually:

```text
Business / Future Agent
        ↓
BringBack WhatsApp Service
        ↓
Tenant connection lookup
        ↓
Credential retrieval
        ↓
Meta Provider
        ↓
WhatsApp Cloud API
        ↓
Provider response
        ↓
Persist message + provider ID/status
```

The caller must not supply arbitrary credentials.

The backend must determine the correct WhatsApp connection from the authenticated tenant/context.

The implementation should support the message types required by the current Phase 1 scope.

The exact supported message types must be determined during planning based on product requirements and Meta API capabilities.

Do not implement a complete marketing-template engine in Phase 1.

---

# 17. MESSAGE STATUS

Outgoing messages may transition through provider states.

The implementation should support the states relevant to Meta, such as:

```text
PENDING
SENT
DELIVERED
READ
FAILED
```

The exact internal enum must be mapped carefully to Meta webhook statuses.

The backend must avoid treating a successful HTTP request to Meta as equivalent to final delivery.

For example:

```text
API accepted
    ≠
Message delivered
```

The provider message ID must be stored so later webhook events can update the correct internal message.

---

# 18. CUSTOMER RELATIONSHIP

Feature 01 already contains customer management.

Feature 03 must integrate with that existing customer domain rather than creating a duplicate customer system.

Where possible:

```text
WhatsApp phone number
        ↓
Existing Customer
        ↓
Customer communications
```

If an inbound WhatsApp number does not match an existing customer, the implementation must follow the existing customer-management rules.

The coding agent must inspect Feature 01 and determine the correct integration.

Do not create a second independent `Customer` table.

---

# 19. DATABASE REQUIREMENTS

The coding agent must inspect the existing Prisma schema and create only the required schema changes.

The implementation plan must document:

- New models
- New enums
- Relationships
- Foreign keys
- Unique constraints
- Indexes
- Nullable vs required fields
- Cascading behavior
- Migration strategy

Likely domain areas include:

```text
Business
   │
   └── WhatsAppConnection
          │
          ├── WhatsAppMessage
          │
          └── WebhookEvent
```

These are conceptual requirements, not mandatory model names.

The agent must reuse existing `Business`/tenant models.

Database indexes should support common operations such as:

- Tenant → connection
- Connection → messages
- Provider message ID lookup
- Webhook event idempotency
- Created-at ordering
- Status filtering

---

# 20. API DESIGN

All authenticated business-facing endpoints must follow the existing API conventions.

Base:

```text
/api/v1
```

A logical resource structure may be:

```text
/api/v1/whatsapp
```

or an equivalent structure consistent with the existing backend.

The implementation plan must define exact routes after inspecting the existing modules.

The API inventory should cover the necessary operations such as:

### Connection

```text
POST   /whatsapp/connect
GET    /whatsapp/connection
POST   /whatsapp/test
POST   /whatsapp/disconnect
```

These are conceptual examples only.

The agent must not implement or document routes that conflict with the existing architecture.

### Messaging

Potentially:

```text
POST   /whatsapp/messages
GET    /whatsapp/messages
GET    /whatsapp/messages/:id
```

Again, exact endpoints must be finalized in the implementation plan.

### Webhook

The webhook must be a separate provider-facing route and must not use normal tenant JWT authentication.

Conceptually:

```text
GET  /webhooks/whatsapp
POST /webhooks/whatsapp
```

Exact routing must follow the backend's existing webhook conventions.

---

# 21. API CONTRACT REQUIREMENTS

Every API in the final implementation plan must specify:

- HTTP method
- Route
- Authentication requirement
- Required role
- Tenant scope
- Request body/query/path parameters
- Validation rules
- Success status
- Response structure
- Error responses
- Pagination where applicable

Do not expose database models directly as API contracts.

DTOs should be used according to existing backend conventions.

---

# 22. AUTHORIZATION

Existing authentication and authorization infrastructure must be reused.

Business-facing endpoints should use the existing:

- JWT authentication
- Tenant guard
- Role guard
- Relevant owner/staff permissions

The implementation must inspect the actual guards and role model in the repository.

Do not create a second authentication mechanism for WhatsApp.

The provider webhook is the explicit exception because Meta is not an application user.

---

# 23. OWNER / STAFF ACCESS

The implementation must define which business roles can:

- View connection status
- Connect WhatsApp
- Disconnect WhatsApp
- Send messages
- View messages
- Test connection

Do not assume every authenticated user has permission to connect/disconnect a business's WhatsApp account.

Use the existing role system.

The implementation plan must document the final permission matrix.

---

# 24. SUPER ADMIN ACCESS

The Super Admin Dashboard should eventually be able to inspect WhatsApp integration health at a platform level without exposing customer secrets.

Potential information:

- Business
- Connection status
- WABA ID
- Phone number/display number
- Provider status
- Last webhook activity
- Last successful communication
- Error state
- Created/updated timestamps

The Super Admin must not receive raw WhatsApp access tokens.

The exact Super Admin APIs are part of backend scope where required for dashboard functionality, but the Phase 1 implementation must not become a complete platform analytics system.

---

# 25. ERROR HANDLING

Provider errors must be normalized into stable backend errors.

The API must not simply forward arbitrary Meta error payloads to clients.

Errors should distinguish between categories such as:

```text
Validation error
Authentication/authorization error
Connection error
Provider error
Webhook verification error
Duplicate event
Message send failure
Internal server error
```

The implementation must follow the existing global exception/error response format.

Provider-specific debugging information should be logged securely but not exposed to clients when sensitive.

---

# 26. TRANSACTIONS

Database operations involving multiple related records must use transactions where atomicity matters.

Examples:

```text
Create/update connection
+
Persist related metadata
```

and:

```text
Persist inbound event
+
Create message
```

where the domain requires atomicity.

Do not use database transactions around slow external Meta API calls unless there is a clear reason.

Avoid holding database transactions open while waiting for external network requests.

---

# 27. ASYNCHRONOUS PROCESSING

The project already uses Redis/BullMQ.

The implementation plan must evaluate which WhatsApp operations should be asynchronous.

Potential candidates include:

- Webhook event processing
- Message status processing
- Retryable provider operations
- High-volume outgoing messages

The webhook endpoint should acknowledge valid Meta requests quickly and avoid unnecessarily long processing.

However, the agent must not introduce queues everywhere without a concrete reason.

Reuse the existing queue architecture.

---

# 28. RETRY POLICY

External provider calls can fail transiently.

The implementation plan must define safe retry behavior for operations where retrying is appropriate.

Retries must not create duplicate messages.

Therefore:

```text
Retry
  +
Idempotency
  +
Provider message tracking
```

must be considered together.

Permanent provider errors must not be retried indefinitely.

---

# 29. RATE LIMITING

Meta API limits and BringBack AI's own API limits must be considered.

The implementation plan should identify:

- Provider rate limits
- Application-level throttling needs
- Queue concurrency
- Retry backoff
- Failure handling

Do not invent arbitrary production limits without documenting the reason and configuration strategy.

---

# 30. LOGGING & OBSERVABILITY

The implementation must use the existing structured logging approach.

Useful operational information includes:

- Tenant/business ID
- Connection ID
- Provider message ID
- Webhook event identifier
- Operation name
- Success/failure
- Error category
- Processing duration

Never log:

- Access tokens
- Secrets
- Authorization headers
- Sensitive message content unnecessarily
- Full provider payloads containing unnecessary PII

The implementation should provide enough information to diagnose:

```text
Meta
 ↓
Webhook
 ↓
BringBack
 ↓
Tenant resolution
 ↓
Message persistence
 ↓
Processing
```

without exposing secrets.

---

# 31. SECURITY REQUIREMENTS

Security is a first-class requirement.

The implementation must protect against:

- Cross-tenant data access
- Credential leakage
- Unauthorized sending
- Forged webhook requests
- Replay/duplicate events
- Injection attacks
- Malformed provider payloads
- Excessive API access
- Sensitive information in logs
- Improper error disclosure

Webhook verification must follow Meta's supported security mechanism.

All external input must be validated.

All database access must remain tenant-scoped where applicable.

---

# 32. DATA PRIVACY

WhatsApp messages can contain customer personal information.

The implementation must avoid unnecessary data collection.

The plan must identify:

- What message data is stored
- Why it is stored
- Which data is required for product functionality
- How long data is retained, where applicable
- Who can access it
- Whether raw provider payloads are necessary

Feature 03 should not create an uncontrolled raw-event data warehouse.

---

# 33. CONFIGURATION & ENVIRONMENT

The implementation must inspect the existing `.env` structure and follow the repository's established configuration pattern.

Meta-related configuration may include values such as:

```text
META_APP_ID
META_APP_SECRET
META_WEBHOOK_VERIFY_TOKEN
META_API_VERSION
```

These are examples of configuration concepts.

The exact variable names and required values must be finalized after inspecting the repository and current Meta integration requirements.

Secrets must remain environment/configuration-managed and must not be committed to Git.

---

# 34. EXTERNAL API VERSIONING

Meta Graph/WhatsApp API versions change over time.

The integration must avoid scattering API version strings throughout the codebase.

Use a centralized configuration/provider mechanism.

The implementation plan must identify:

- Current Meta API version
- Where it is configured
- How upgrades will be handled
- Whether provider URLs are centralized

The coding agent must verify the currently supported Meta API version during implementation.

---

# 35. TESTING REQUIREMENTS

Feature 03 Phase 1 is not complete when the code merely compiles.

The backend must have automated tests covering the critical behavior.

At minimum, the plan should cover:

### Unit tests

- WhatsApp service
- Provider adapter
- Credential handling
- Tenant resolution
- Message mapping
- Status mapping
- Error mapping
- Idempotency logic

### Integration tests

- Create connection
- Retrieve connection
- Tenant isolation
- Send message flow
- Webhook verification
- Inbound message persistence
- Duplicate webhook handling
- Message status update
- Disconnect flow

### Security tests

- Unauthorized access
- Wrong-tenant access
- Forbidden role
- Invalid webhook verification
- Credential exposure checks

### Build validation

```text
TypeScript
ESLint
Unit tests
Integration tests
Production build
```

The agent must report the exact test results after implementation.

---

# 36. API TESTING WITH META

Real Meta API credentials may not be available in the development environment.

The implementation should therefore separate:

```text
Business logic
        ↓
Provider interface
        ↓
Meta implementation
```

so provider behavior can be tested using mocks/stubs where appropriate.

If real Meta credentials are available, the agent may perform controlled integration testing without committing secrets.

Never commit real Meta credentials.

---

# 37. FEATURE 01 DEPENDENCY

Feature 03 must reuse the existing business and customer architecture from Feature 01.

Do not recreate:

- Business model
- Tenant model
- Customer model
- Authentication
- JWT system
- Tenant guard
- Role system

unless repository inspection proves a missing requirement.

WhatsApp communication should integrate into the existing customer domain.

---

# 38. FEATURE 02 DEPENDENCY

Feature 03 must coexist with the Feature 02 AI Business Analyst Agent.

Feature 03 may eventually provide communication data that Feature 02 can analyze.

However, Phase 1 must not modify Feature 02 analytics unless the implementation plan identifies a concrete required integration.

Do not unnecessarily change completed Feature 02 functionality.

---

# 39. DOMAIN BOUNDARY

Feature 03 Phase 1 owns:

```text
WhatsApp connection
WhatsApp provider integration
WhatsApp webhook processing
WhatsApp messages
WhatsApp message statuses
WhatsApp communication infrastructure
```

It does not own:

```text
AI campaign generation
AI sales recommendations
AI chatbot intelligence
Customer segmentation
Marketing campaign orchestration
Voice calling
Email communication
```

Those belong to other features/phases.

---

# 40. OUT OF SCOPE

The following are explicitly OUT OF SCOPE for Feature 03 Phase 1:

### Other communication channels

- Email integration
- Voice integration
- SMS integration
- Telegram integration
- Other messaging providers

### AI agents

- WhatsApp AI chatbot
- AI sales agent
- AI campaign agent
- AI autonomous customer follow-up
- AI conversation intelligence

### Marketing

- Campaign creation
- Campaign scheduling
- Bulk campaign orchestration
- Marketing template management beyond what is strictly required for basic Phase 1 messaging
- Automated promotions

### Advanced CRM

- New CRM system
- Customer segmentation engine
- Lead scoring
- Customer lifecycle automation

### Analytics

- Complete WhatsApp analytics dashboard
- Campaign analytics
- Revenue attribution
- Advanced conversation analytics

### Voice

- Voice agent
- Telephony
- Call recording
- Speech-to-text
- Text-to-speech

These must not be silently added during implementation.

---

# 41. EXPECTED IMPLEMENTATION PLAN FROM THE CODING AGENT

Before coding, the agent must inspect the existing backend and return a detailed implementation plan.

The plan should include:

## A. Repository analysis

- Existing modules
- Existing authentication
- Existing tenant architecture
- Existing Prisma schema
- Existing Redis/BullMQ architecture
- Existing configuration
- Existing API conventions
- Existing testing conventions

## B. Files to create

Exact paths.

## C. Files to modify

Exact paths.

## D. Database changes

- Models
- Enums
- Relations
- Indexes
- Constraints
- Migration

## E. Services

- WhatsApp service
- Provider adapter
- Webhook service
- Message service
- Any required supporting services

## F. Controllers

Exact routes and responsibilities.

## G. DTOs

Exact request/response DTOs and validation.

## H. Security

- Tenant isolation
- Roles
- Credential protection
- Webhook verification

## I. Queue processing

Exact jobs, queues, retry strategy, and reason for each.

## J. Testing

Exact unit/integration/security tests.

## K. Dependencies

Any new npm packages and why they are necessary.

Do not add dependencies when existing packages can perform the job adequately.

## L. Migration / deployment considerations

- Environment variables
- Database migration
- Webhook URL
- Meta configuration
- Production requirements

---

# 42. PLAN MUST NOT START IMPLEMENTATION

The coding agent must stop after producing the implementation plan.

The human reviewer will inspect:

```text
Architecture
Database
API
Security
Meta integration
Tenant isolation
Queues
Testing
Scope
```

Only after explicit approval should implementation begin.

---

# 43. DEFINITION OF DONE

Feature 03 Phase 1 Backend is complete only when all applicable requirements are satisfied.

### WhatsApp connection

- [ ] Tenant can connect WhatsApp Business
- [ ] Connection is persisted
- [ ] Correct Meta identifiers are stored
- [ ] Credentials are securely handled
- [ ] Connection status is available
- [ ] Disconnect/reconnect behavior works

### Webhooks

- [ ] Meta webhook verification works
- [ ] Valid webhook events are accepted
- [ ] Invalid events are rejected safely
- [ ] Tenant is correctly resolved
- [ ] Duplicate events are handled idempotently

### Messaging

- [ ] Inbound messages can be persisted
- [ ] Outbound messages can be sent through backend
- [ ] Provider message IDs are stored
- [ ] Message status is tracked
- [ ] Provider errors are handled

### Security

- [ ] Tenant isolation verified
- [ ] Role authorization verified
- [ ] Credentials never exposed
- [ ] Sensitive information not logged
- [ ] Webhook security implemented

### Quality

- [ ] Unit tests pass
- [ ] Integration tests pass
- [ ] Security tests pass
- [ ] TypeScript passes
- [ ] ESLint passes
- [ ] Production build passes
- [ ] Database migration succeeds
- [ ] No regression in Feature 01
- [ ] No regression in Feature 02

---

# 44. SUCCESS CRITERIA

A successful implementation should allow the following conceptual journey:

```text
Business Owner
      ↓
BringBack AI
      ↓
Connect WhatsApp Business
      ↓
Meta authentication/onboarding
      ↓
WhatsApp Business Account identified
      ↓
Phone Number identified
      ↓
Credentials securely stored
      ↓
Connection validated
      ↓
Status = Connected
      ↓
Customer sends WhatsApp message
      ↓
Meta webhook
      ↓
BringBack Backend
      ↓
Tenant resolved
      ↓
Message persisted
      ↓
Future AI Agent can consume message
```

And outbound:

```text
Future Business Feature / AI Agent
      ↓
BringBack WhatsApp Service
      ↓
Correct tenant connection
      ↓
Meta WhatsApp Cloud API
      ↓
Customer WhatsApp
      ↓
Provider status webhook
      ↓
BringBack updates message status
```

---

# 45. FINAL AI DEVELOPMENT INSTRUCTION

You are implementing **BringBack AI — Feature 03 Phase 1: WhatsApp Communication Channel**.

Before writing code:

1. Inspect the entire existing backend repository.
2. Understand Feature 01 implementation.
3. Understand Feature 02 implementation.
4. Identify the existing authentication, tenant, role, Prisma, Redis/BullMQ, logging, configuration, and testing patterns.
5. Inspect the current database schema.
6. Inspect existing API conventions.
7. Inspect existing customer/business relationships.
8. Verify the current Meta WhatsApp Business Cloud API requirements from official Meta documentation.
9. Determine the minimum production-grade architecture required.
10. Identify exactly which files need to be created or modified.
11. Identify database migrations.
12. Identify APIs and DTOs.
13. Identify security and webhook handling.
14. Identify queue/retry requirements.
15. Identify automated tests.

Then produce a **complete implementation plan**.

### DO NOT IMPLEMENT YET.

Stop after presenting the plan and wait for explicit human approval.

After approval, implement only the approved plan.

Do not silently expand the scope.

Do not implement Email or Voice.

Do not implement the WhatsApp AI chatbot.

Do not implement the AI Offer Campaign Agent.

Do not rebuild Feature 01 or Feature 02.

Do not expose Meta credentials.

Do not bypass tenant isolation.

Do not invent APIs or database fields without checking the existing repository and current Meta requirements.

The implementation must be production-oriented, secure, testable, maintainable, and consistent with the existing BringBack AI backend architecture.

---

# 46. FINAL PRINCIPLE

Feature 03 Phase 1 is the **WhatsApp communication infrastructure**, not the final WhatsApp AI product.

Build the foundation correctly so future BringBack AI agents can use it safely:

```text
                    BringBack AI
                         │
              Communication Layer
                         │
                    WhatsApp
                         │
              Meta Cloud API
                         │
             ┌───────────┴───────────┐
             │                       │
          Inbound                 Outbound
             │                       │
        Customer                 AI / Business
             │                       │
             └──────────┬────────────┘
                        │
                  Future Agents
```

The architecture must make future agents consumers of this communication layer, not force each agent to implement its own WhatsApp integration.
