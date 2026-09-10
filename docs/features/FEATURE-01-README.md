FEATURE 01
Business Onboarding & Customer Management
Backend Development Specification
Product: AI Sales Assistant for Clothing Retailers
Feature: Business Onboarding & Customer Management
Application: Backend API
Backend Owner: Blaster
Database: PostgreSQL
Object Storage: Cloudflare R2
Cache / Queue: Redis
Backend Framework: NestJS + TypeScript
ORM: Prisma
AI Providers: Gemini / OpenAI through backend-controlled AI services

1. IMPORTANT CONTEXT
This repository is an independent backend project.
The backend development environment does NOT have access to the mobile application repository or Super Admin Dashboard repository.
Therefore, this document contains all necessary context for Feature 01.
The backend is the central source of truth for the entire SaaS platform.
The backend will eventually serve:

Business Owner Mobile Application
Super Admin Dashboard
AI services
WhatsApp integrations
Voice integrations
Future external integrations

The backend must therefore be designed as a stable, secure, production-grade API platform.

2. PRODUCT OVERVIEW
The product is an AI-powered sales assistant initially designed for clothing retailers.
The system will eventually help business owners:

Understand their sales
Understand their customers
Create promotional offers
Generate campaign material
Reach customers through WhatsApp
Have AI conversations with customers
Make outbound voice calls
Follow up with customers
Analyze business performance
Receive AI-powered business recommendations

The core product philosophy is:

Minimum input from the business owner → maximum useful action from the AI system.

This is NOT intended to become a generic CRM, ERP or accounting platform in the MVP.

3. APPLICATION ECOSYSTEM
The complete product contains three independent applications.
Business Owner Mobile App
Technology:
React Native CLI
Purpose:
The business owner uses this application to operate their business through the platform.
Examples:

Manage business profile
Manage customers
Create campaigns
View analytics
Interact with Business Analyst
Manage WhatsApp AI
Manage voice campaigns


Super Admin Dashboard
Technology:
Web application
Purpose:
Internal platform administration.
The Super Admin can eventually:

Manage businesses
Manage platform users
Inspect customers
Monitor campaigns
Monitor AI usage
Monitor WhatsApp
Monitor voice
Manage subscriptions
Monitor system health


Backend
Technology:
NestJS + TypeScript
Purpose:
Central API and business logic layer.
The backend owns:

Authentication
Authorization
Business logic
Database access
AI orchestration
File handling
Integrations
Validation
Tenant isolation
Background jobs
Auditability


4. FEATURE 01 PURPOSE
Feature 01 establishes the foundational identity and customer information for every business.
It provides:

Owner authentication foundation
Business profile
Business operating hours
Customer management
Customer import
Customer communication preferences
File management foundation
Import history
Multi-tenant data foundation

Future features depend on this information.

5. OWNER AUTHENTICATION
Business owners authenticate using:
Mobile Number
Password

The backend must:

Validate credentials
Securely hash passwords
Never store plaintext passwords
Authenticate users
Issue access tokens
Support refresh tokens
Enforce authorization
Support logout/session invalidation strategy

Recommended authentication architecture:
Owner Mobile App
       |
       v
POST /auth/login
       |
       v
Backend
       |
       v
Validate credentials
       |
       v
Access Token + Refresh Token

The exact token strategy must be finalized during implementation planning.

6. SUPER ADMIN AUTHENTICATION
For the current MVP, Super Admin authentication may be temporarily hardcoded.
However, backend authorization must still conceptually distinguish:
OWNER
SUPER_ADMIN

Do not build authorization in a way that requires major restructuring when proper Super Admin authentication is introduced.

7. MULTI-TENANCY
This is a multi-tenant SaaS.
Example:
Business A
 ├── Customers
 ├── Campaigns
 ├── Sales
 └── Conversations

Business B
 ├── Customers
 ├── Campaigns
 ├── Sales
 └── Conversations

Business A must NEVER access Business B's data.
Every business-owned entity must have a reliable tenant relationship.
The backend must enforce tenant isolation.
The implementation plan must evaluate:

Service-layer tenant enforcement
Authorization guards
PostgreSQL Row-Level Security where appropriate
Database constraints
Testing for cross-tenant access

A frontend restriction is NOT security.

8. BUSINESS PROFILE
The system must store basic business information.
Required
Business Name
Business Phone
Address
City
State
Country
Pincode
Logo
Business Hours

Optional
Email
Website
Instagram
Facebook
Business Description

Do not add unnecessary fields to Feature 01.
Future features will introduce:
Return Policy
Exchange Policy
Delivery Policy
Payment Methods
FAQs
Products


9. WHY BUSINESS INFORMATION IS REQUIRED
Business Name
Used by:

Application UI
AI context
Customer communication
Campaigns
Poster generation

Business Phone
Used as:

Business contact
Future WhatsApp identity
Future voice integration information

Address
Required so future AI agents can answer:

Where is your store?

Business Hours
Required so future AI agents can answer:

Are you open today?

Logo
Required for:

Business branding
Campaign posters
Future communication

The actual image belongs in Cloudflare R2.

10. BUSINESS HOURS
Business hours must support different schedules per day.
Example:
Monday     10:00 - 21:00
Tuesday    10:00 - 21:00
Wednesday  10:00 - 21:00
Thursday   10:00 - 21:00
Friday     10:00 - 21:00
Saturday   10:00 - 21:00
Sunday     Closed

Do NOT assume one opening time and closing time for every day.
Conceptual entity:
business_hours

id
business_id
day_of_week
open_time
close_time
is_closed

Exact schema must be finalized before implementation.

11. CUSTOMER MANAGEMENT
Customers can enter the system through:

Manual entry
Excel/CSV import
Image-based extraction

The minimum customer information is:
Name
Mobile Number

Optional:
Email
Gender
Date of Birth
Address
City


12. WHY CUSTOMER INFORMATION IS REQUIRED
Name
Required for:

Identification
Personalized communication
AI conversations
Campaign personalization

Mobile Number
Critical for:

WhatsApp
Voice
Customer identification
Duplicate detection

Gender
Useful for:

Campaign targeting
Customer segmentation

Example:

Promote women's clothing to relevant customers.

Date of Birth
Future use:

Birthday campaigns
Personalized offers

Address / City
Future use:

Delivery
Location-based targeting
Customer segmentation

Email
Future email communication.
Optional data should remain optional.

13. PHONE NUMBER NORMALIZATION
Phone numbers must be normalized centrally before persistence.
Possible representations:
9876543210
+91 9876543210
+91-9876543210
919876543210

These may represent the same number.
The backend should normalize them to a canonical representation.
For Indian customers, the expected canonical representation will generally be:
+919876543210

Phone normalization must exist in one reusable backend service/utility.
Do not duplicate phone normalization logic across controllers.

14. DUPLICATE CUSTOMER PREVENTION
A business should not have multiple customer records for the same normalized mobile number unless a future business rule explicitly allows it.
Conceptual uniqueness:
business_id + normalized_mobile_number

The database should enforce uniqueness where appropriate.
Do NOT rely only on frontend duplicate detection.

15. CUSTOMER COMMUNICATION PREFERENCES
The platform will eventually communicate with customers through:

WhatsApp
Voice
Email

Therefore, communication preferences need to be represented.
Conceptually:
customer_communication_preferences

id
customer_id
whatsapp_marketing
voice_marketing
email_marketing
do_not_contact
created_at
updated_at

The final consent architecture must be designed carefully before implementation.
The campaign system must not blindly contact every customer.

16. CUSTOMER SOURCE
The system should record how each customer entered the platform.
Possible sources:
MANUAL
CSV
EXCEL
IMAGE
IMPORT
WHATSAPP
CAMPAIGN

This helps:

Debugging
Analytics
Super Admin
Import auditing
Product analysis


17. EXCEL / CSV IMPORT
Never directly insert uploaded spreadsheet rows into the production customer table.
Required flow:
Upload
  ↓
File validation
  ↓
Parsing
  ↓
Column detection / mapping
  ↓
Data normalization
  ↓
Validation
  ↓
Duplicate detection
  ↓
Import preview
  ↓
Owner confirmation
  ↓
Database import

Example:
Total Rows: 2000
Valid: 1942
Invalid: 31
Duplicates: 27

The owner confirms before final insertion.

18. IMPORT HISTORY
Customer imports should be tracked.
A conceptual import record may contain:
id
business_id
file_id
import_type
status
total_rows
valid_rows
invalid_rows
duplicate_rows
created_by
created_at
completed_at

This allows:

Troubleshooting
Super Admin visibility
Import history
Error analysis
Future retry capabilities


19. IMAGE CUSTOMER IMPORT
The owner may upload an image containing customer information.
Example:
customer-list.jpg

The backend may send the image to a vision-capable AI provider such as Gemini or OpenAI.
Flow:
Image
 ↓
Cloudflare R2
 ↓
AI Vision
 ↓
Structured JSON
 ↓
Backend Validation
 ↓
Phone Normalization
 ↓
Duplicate Detection
 ↓
Preview
 ↓
Owner Confirmation
 ↓
PostgreSQL

CRITICAL RULE:

AI output must never automatically become trusted database truth.

AI extracts.
Backend validates.
Owner confirms.
Database stores.

20. AI PROVIDER ARCHITECTURE
AI providers must be accessed only from the backend.
The mobile application and Super Admin Dashboard must never contain AI provider secrets.
Use an abstraction such as:
AIService
 ├── GeminiProvider
 ├── OpenAIProvider
 └── FutureProvider

The rest of the backend should depend on the abstraction rather than hardcoding one provider throughout the codebase.
This allows future provider changes without rewriting business logic.

21. CLOUDflare R2
Cloudflare R2 is the object storage layer.
Potential structure:
businesses/
  {business_id}/
    logo/
    customer-imports/
    bills/
    products/
    campaigns/
    documents/

Feature 01 mainly requires:
logo/
customer-imports/

PostgreSQL should store metadata/object references rather than large binary files.
Conceptual:
file_uploads

id
business_id
file_name
file_type
storage_key
file_size
uploaded_by
created_at

Use secure access mechanisms.
Do not expose permanent private storage credentials to clients.

22. REDIS
Redis can support:

Background jobs
Large import processing
Temporary state
Rate limiting
Caching where appropriate

Large imports should not unnecessarily block HTTP requests.
Potential flow:
API
 ↓
Queue
 ↓
Redis-backed Worker
 ↓
Import Processing


23. DATABASE
PostgreSQL is the primary source of truth.
Feature 01 will likely require entities such as:
users
businesses
business_users
business_hours
customers
customer_communication_preferences
customer_imports
customer_import_rows
file_uploads

This is a conceptual model.
Before coding, determine:

Exact schema
Primary keys
Foreign keys
Constraints
Indexes
Unique constraints
Cascading behavior
Soft deletion strategy
Audit requirements


24. IMPORTANT DATABASE PRINCIPLE
PostgreSQL is the source of truth.
AI should NOT calculate and permanently store authoritative business data without validation.
For future Business Analyst functionality:
User Question
 ↓
LLM understands intent
 ↓
Backend controlled function
 ↓
PostgreSQL query
 ↓
Authoritative result
 ↓
LLM explains result

The AI is the reasoning interface.
The database remains the source of truth.

25. API DESIGN
The backend will expose APIs for the Business Owner Mobile App and Super Admin Dashboard.
Potential owner APIs:
POST /auth/register
POST /auth/login
POST /auth/refresh
POST /auth/logout

GET /business
PATCH /business
POST /business/logo

GET /business/hours
PUT /business/hours

GET /customers
POST /customers
GET /customers/:id
PATCH /customers/:id
DELETE /customers/:id

POST /customers/import
GET /customers/import/:id
POST /customers/import/:id/confirm

Potential Super Admin APIs:
GET /admin/dashboard
GET /admin/businesses
GET /admin/businesses/:id
GET /admin/businesses/:id/customers
GET /admin/customers
GET /admin/customers/:id
GET /admin/imports
GET /admin/imports/:id

These are conceptual endpoint groups.
Do not implement blindly.
Finalize exact contracts before implementation.

26. API CONTRACT PRINCIPLE
The backend API contract is the source of truth between independent repositories.
The mobile app and Super Admin Dashboard must consume the backend API.
Do not require either frontend project to know anything about:

PostgreSQL
Prisma
Redis
Internal services
AI provider implementation
R2 credentials


27. VALIDATION
Validate all client-provided data on the backend.
Examples:

Mobile number
Password
Business name
Email
Gender
Date of birth
File type
File size
Import data
IDs
Query parameters

Client-side validation is useful for UX.
Backend validation is authoritative.

28. ERROR HANDLING
Provide consistent error responses.
Possible errors:
INVALID_CREDENTIALS
VALIDATION_ERROR
DUPLICATE_CUSTOMER
CUSTOMER_NOT_FOUND
BUSINESS_NOT_FOUND
FORBIDDEN
UNAUTHORIZED
INVALID_FILE
FILE_TOO_LARGE
IMPORT_FAILED
AI_PROCESSING_FAILED
STORAGE_ERROR
INTERNAL_ERROR

Do not expose:

Stack traces
SQL errors
Secrets
Internal implementation details

to production clients.

29. PAGINATION
Customer datasets may become very large.
The API must support pagination.
Do not return every customer in a single request.
The implementation plan should evaluate:

Cursor pagination
Offset pagination
Sorting
Filtering
Search indexes

For large datasets, cursor-based pagination should be considered.

30. SECURITY
Production implementation must consider:

Password hashing
JWT security
Refresh token security
Authentication guards
Authorization
Tenant isolation
Rate limiting
Input validation
Secure file handling
File size limits
File type validation
Secrets management
Secure HTTP headers
Audit logs
Database security
R2 security
AI API key protection

Never place secrets in source code.
Never send AI API keys to mobile applications.

31. TRANSACTIONS AND DATA CONSISTENCY
Operations affecting multiple database entities should use appropriate transactions.
For example:
Import
 ├── Import record
 ├── Import rows
 └── Customers

Determine which operations need atomicity.
Large imports should be designed for reliability and performance.

32. IDEMPOTENCY
Production APIs should consider duplicate requests.
Example:
The mobile app sends:
Create Customer

and network conditions cause a retry.
The backend should avoid accidentally creating duplicate records.
Use appropriate database constraints and idempotency strategies where necessary.

33. OBSERVABILITY
Production backend should have:

Structured logging
Request IDs
Error tracking
Database monitoring
Queue monitoring
Import processing status
AI API failure logging
Storage operation logging

Never log passwords or secret credentials.
Avoid unnecessarily logging sensitive customer information.

34. TESTING
Feature 01 must include appropriate:
Unit tests
Phone normalization.
Validation.
Duplicate detection.
Business logic.
Integration tests
Authentication.
Business APIs.
Customer APIs.
Import processing.
Database transactions.
Authorization tests
Business A attempting to access Business B.
This MUST fail.
File tests
Invalid file.
Oversized file.
Corrupt file.
Unsupported format.
AI extraction tests
Malformed AI output.
Missing phone number.
Invalid phone number.
Duplicate extracted customer.
AI provider failure.

35. FEATURE 01 OWNER JOURNEY
Expected complete flow:
Owner
 ↓
Login
 ↓
Business onboarding
 ↓
Business profile
 ↓
Upload logo
 ↓
Set business hours
 ↓
Customer management
 ├── Add manually
 ├── Import Excel/CSV
 └── Import image
 ↓
Validation
 ↓
Preview
 ↓
Confirmation
 ↓
PostgreSQL


36. FEATURE 01 SUCCESS CRITERIA
Feature 01 backend is complete when:

Owner authentication works
Business profile APIs work
Business hours APIs work
Logo upload works
Customer CRUD works
Phone normalization works
Duplicate prevention works
Customer filtering/search works
Pagination works
Excel/CSV import works
Import validation works
Import history works
Image extraction works
AI output validation works
Communication preferences work
R2 integration works
Redis/background processing works where required
Super Admin APIs work
Tenant isolation is verified
Security tests pass
Critical automated tests pass
Logging and error handling are production-ready


37. OUT OF SCOPE
Do NOT implement in Feature 01:

WhatsApp AI
Voice AI
Campaign engine
Business Analyst
Sales analytics
Product recommendation
Inventory
Accounting
GST
Payroll
Loyalty system
Full CRM

These belong to future features.

38. FINAL AI DEVELOPMENT INSTRUCTION
Before writing implementation code:

Inspect the existing backend repository.
Understand the current architecture.
Identify existing reusable infrastructure.
Design the complete Feature 01 domain model.
Design PostgreSQL schema.
Design relationships.
Design constraints.
Design indexes.
Design migrations.
Design authentication.
Design authorization.
Design tenant isolation.
Design API contracts.
Design Cloudflare R2 integration.
Design Redis/background processing.
Design customer import pipeline.
Design AI extraction architecture.
Design validation.
Design error handling.
Design logging and observability.
Design testing strategy.
Identify security risks.
Identify scalability risks.
Identify failure/retry scenarios.

Then produce a complete production-grade implementation plan.
The implementation plan must follow established enterprise engineering practices.
Prioritize:

Security
Reliability
Maintainability
Scalability
Testability
Observability
Clean architecture
Strong database integrity
Multi-tenant isolation
API contract stability
Secure AI integration
Production deployment readiness

Do not immediately start coding.
First understand the repository, produce the implementation plan, identify architectural decisions, and only then begin implementation.