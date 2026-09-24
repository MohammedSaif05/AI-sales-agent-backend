# Bringback AI — Feature 01: Business Onboarding & Customer Management
## Comprehensive Technical Architecture & Engineering Documentation

- **Project:** Bringback AI Backend (`sales-agent-backend`)
- **Feature Name:** Feature 01 — Business Onboarding, Multi-Device Authentication, Customer Management & Staged Imports
- **Author / Architect:** Senior Backend Architect & Technical Documentation Engineer
- **Status:** **Implementation Complete, Audited & Verified (100% Tests Passing)**
- **Target Audience:** Backend Engineers, Mobile App Engineers, Frontend Engineers, DevOps

---

## Table of Contents

1. [Executive Summary & Core Architectural Philosophy](#1-executive-summary--core-architectural-philosophy)
2. [Database Schema & Entity Relationship Model](#2-database-schema--entity-relationship-model)
3. [Authentication, Sessions & Token Lifecycle](#3-authentication-sessions--token-lifecycle)
4. [Business Profile, Operating Schedule & Storage Subsystem](#4-business-profile-operating-schedule--storage-subsystem)
5. [Customer Management & Canonical Phone Normalizer](#5-customer-management--canonical-phone-normalizer)
6. [Staged Customer Import Pipeline (CSV, Excel & AI Vision)](#6-staged-customer-import-pipeline-csv-excel--ai-vision)
7. [Super Admin Cross-Tenant Inspection Subsystem](#7-super-admin-cross-tenant-inspection-subsystem)
8. [Complete API Specification & Request/Response Contracts](#8-complete-api-specification--requestresponse-contracts)
   - [8.1 Authentication APIs (`/api/v1/auth/*`)](#81-authentication-apis-apiv1auth)
   - [8.2 Business Profile & Hours APIs (`/api/v1/business/*`)](#82-business-profile--hours-apis-apiv1business)
   - [8.3 Customer Management APIs (`/api/v1/customers/*`)](#83-customer-management-apis-apiv1customers)
   - [8.4 Customer Import APIs (`/api/v1/customers/import/*`)](#84-customer-import-apis-apiv1customersimport)
   - [8.5 Super Admin Feature 01 APIs (`/api/v1/admin/*`)](#85-super-admin-feature-01-apis-apiv1admin)
9. [Security, RBAC & Multi-Tenant Isolation](#9-security-rbac--multi-tenant-isolation)
10. [Automated Test Matrix & Verification Suites](#10-automated-test-matrix--verification-suites)
11. [Developer Setup, Configuration & Troubleshooting](#11-developer-setup-configuration--troubleshooting)

---

## 1. Executive Summary & Core Architectural Philosophy

Feature 01 is the foundational core of the Bringback AI platform. It provides the central identity, store profile, operating schedule, customer directory, bulk customer onboarding, and administrative observability infrastructure.

```
+-----------------------------------------------------------------------------------+
|                        FEATURE 01 FOUNDATIONAL ECOSYSTEM                          |
|                                                                                   |
|  +-----------------------------------------------------------------------------+  |
|  | Multi-Device Session Auth (Argon2 + Dual JWT Token Rotation + Revocation)   |  |
|  +-----------------------------------------------------------------------------+  |
|                                       |                                           |
|         +-----------------------------+-----------------------------+             |
|         |                                                           |             |
|         v                                                           v             |
|  +---------------------------+                             +-------------------+  |
|  | Business Profile & Hours  |                             | Customer Directory|  |
|  | - Store metadata & Logo   |                             | - E.164 Normalizer|  |
|  | - 7-Day Schedule Matrix   |                             | - Soft Deletes    |  |
|  | - Cloudflare R2 Storage   |                             | - Consent Matrix  |  |
|  +---------------------------+                             +-------------------+  |
|                                                                     ^             |
|                                                                     |             |
|  +-----------------------------------------------------------------------------+  |
|  | Staged Customer Import Pipeline (Upload -> Parse -> Preview -> Confirm)      |  |
|  | Formats: CSV (.csv) | Excel (.xlsx) | Physical Ledger Photos (AI Vision OCR) |  |
|  +-----------------------------------------------------------------------------+  |
|                                       |                                           |
|                                       v                                           |
|  +-----------------------------------------------------------------------------+  |
|  | Super Admin Observability (Cross-Tenant Store, Customer & Import Auditing)  |  |
|  +-----------------------------------------------------------------------------+  |
+-----------------------------------------------------------------------------------+
```

### Core Engineering Invariants:
1. **Multi-Tenant Server Isolation:** Every customer profile, file upload, import job, and schedule record is strictly partitioned by `businessId`. Store owners can never access another merchant's data.
2. **Canonical E.164 Phone Normalization:** All Indian mobile phone numbers are normalized to `+91XXXXXXXXXX` upon ingestion (registration, manual customer entry, CSV/Excel/Image import).
3. **No Assumed Marketing Consent:** Marketing communication preferences (`whatsappMarketing`, `voiceMarketing`, `emailMarketing`, `doNotContact`) default to `false`. Consent must be explicitly recorded with audit timestamps.
4. **Soft-Delete Referential Preservation:** Customers are never hard-deleted from the database; setting `deletedAt` preserves historical references, campaign logs, and analytics integrity.
5. **Staged Preview Import Architecture:** Bulk imports follow a 4-phase lifecycle: `Upload -> Staged Parse -> Owner Preview (Valid/Duplicate/Invalid) -> Idempotent Confirmation`.

---

## 2. Database Schema & Entity Relationship Model

- **Database Engine:** PostgreSQL 16+
- **Prisma Schema Location:** `prisma/schema.prisma`

### 2.1 Enums

```prisma
enum SystemRole {
  USER
  SUPER_ADMIN
}

enum BusinessRole {
  OWNER
  STAFF
}

enum Gender {
  MALE
  FEMALE
  OTHER
  UNSPECIFIED
}

enum CustomerSource {
  MANUAL
  CSV
  EXCEL
  IMAGE
  IMPORT
  WHATSAPP
  CAMPAIGN
}

enum FileCategory {
  LOGO
  CUSTOMER_IMPORT
}

enum ImportType {
  CSV
  EXCEL
  IMAGE
}

enum ImportStatus {
  PENDING
  PARSING
  PREVIEW_READY
  PROCESSING
  COMPLETED
  FAILED
}

enum ImportRowStatus {
  VALID
  INVALID
  DUPLICATE
}
```

### 2.2 Models & Relationship Graph

```
 [User] 1 -------- * [UserSession]
   |
   | 1
   |
   *
 [BusinessUser] * -------- 1 [Business]
                                |
                                +--- 1..* [BusinessHours]
                                +--- 0..* [FileUpload]
                                +--- 0..* [Customer] 1 --- 1 [CustomerCommunicationPreferences]
                                +--- 0..* [CustomerImport] 1 --- * [CustomerImportRow]
```

#### 1. `User` & `UserSession`
Tracks platform users (owners, staff, super admins) and multi-device active sessions.

```prisma
model User {
  id           String      @id @default(uuid())
  phone        String      @unique // Canonical E.164: +91XXXXXXXXXX
  passwordHash String
  name         String?
  systemRole   SystemRole  @default(USER)
  isActive     Boolean     @default(true)
  createdAt    DateTime    @default(now())
  updatedAt    DateTime    @updatedAt

  sessions      UserSession[]
  businessUsers BusinessUser[]
  fileUploads   FileUpload[]
  imports       CustomerImport[]
  analyses      BusinessAnalysis[] @relation("UserAnalyses")
  questions     BusinessQuestion[] @relation("UserQuestions")

  @@index([phone])
}

model UserSession {
  id               String   @id @default(uuid())
  userId           String
  refreshTokenHash String
  deviceInfo       String?
  ipAddress        String?
  userAgent        String?
  isRevoked        Boolean  @default(false)
  expiresAt        DateTime
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([expiresAt])
}
```

#### 2. `Business`, `BusinessUser` & `BusinessHours`
Represents the merchant store entity, user-store memberships, and the 7-day operating schedule.

```prisma
model Business {
  id          String   @id @default(uuid())
  name        String
  phone       String   // Canonical contact
  address     String
  city        String
  state       String
  country     String   @default("India")
  pincode     String
  logoKey     String?  // Cloudflare R2 storage key
  email       String?
  website     String?
  instagram   String?
  facebook    String?
  description String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  businessUsers BusinessUser[]
  hours         BusinessHours[]
  customers     Customer[]
  fileUploads   FileUpload[]
  imports       CustomerImport[]
  analyses      BusinessAnalysis[] @relation("BusinessAnalyses")
  questions     BusinessQuestion[] @relation("BusinessQuestions")

  @@index([phone])
}

model BusinessUser {
  id         String       @id @default(uuid())
  businessId String
  userId     String
  role       BusinessRole @default(OWNER)
  createdAt  DateTime     @default(now())
  updatedAt  DateTime     @updatedAt

  business Business @relation(fields: [businessId], references: [id], onDelete: Cascade)
  user     User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([businessId, userId])
  @@index([userId])
  @@index([businessId])
}

model BusinessHours {
  id         String   @id @default(uuid())
  businessId String
  dayOfWeek  Int      // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  openTime   String?  // HH:mm (e.g. "10:00")
  closeTime  String?  // HH:mm (e.g. "21:00")
  isClosed   Boolean  @default(false)

  business Business @relation(fields: [businessId], references: [id], onDelete: Cascade)

  @@unique([businessId, dayOfWeek])
}
```

#### 3. `Customer` & `CustomerCommunicationPreferences`
Stores customer records and their granular channel marketing consents.

```prisma
model Customer {
  id              String         @id @default(uuid())
  businessId      String
  name            String
  rawPhone        String
  normalizedPhone String         // Canonical E.164: +91XXXXXXXXXX
  email           String?
  gender          Gender?        @default(UNSPECIFIED)
  dob             DateTime?
  address         String?
  city            String?
  source          CustomerSource @default(MANUAL)
  importId        String?
  deletedAt       DateTime?      // Soft delete timestamp
  createdAt       DateTime       @default(now())
  updatedAt       DateTime       @updatedAt

  business    Business                         @relation(fields: [businessId], references: [id], onDelete: Cascade)
  import      CustomerImport?                  @relation(fields: [importId], references: [id], onDelete: SetNull)
  preferences CustomerCommunicationPreferences?

  @@index([businessId, deletedAt])
  @@index([businessId, normalizedPhone])
  @@index([businessId, name])
  @@index([businessId, createdAt])
}

model CustomerCommunicationPreferences {
  id                String   @id @default(uuid())
  customerId        String   @unique
  whatsappMarketing Boolean  @default(false)
  voiceMarketing    Boolean  @default(false)
  emailMarketing    Boolean  @default(false)
  doNotContact      Boolean  @default(false)
  consentSource     String?  @default("ONBOARDING_NO_CONSENT")
  consentTimestamp  DateTime @default(now())
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  customer Customer @relation(fields: [customerId], references: [id], onDelete: Cascade)
}
```

#### 4. `FileUpload`, `CustomerImport` & `CustomerImportRow`
Underpins the staged bulk import pipeline and object storage tracking.

```prisma
model FileUpload {
  id           String       @id @default(uuid())
  businessId   String
  fileName     String
  fileType     String       // MIME type
  storageKey   String       @unique // Cloudflare R2 key
  fileSize     Int          // bytes
  category     FileCategory
  uploadedById String
  createdAt    DateTime     @default(now())

  business   Business         @relation(fields: [businessId], references: [id], onDelete: Cascade)
  uploadedBy User             @relation(fields: [uploadedById], references: [id])
  imports    CustomerImport[]

  @@index([businessId])
}

model CustomerImport {
  id             String       @id @default(uuid())
  businessId     String
  fileId         String?
  importType     ImportType
  status         ImportStatus @default(PENDING)
  totalRows      Int          @default(0)
  validRows      Int          @default(0)
  invalidRows    Int          @default(0)
  duplicateRows  Int          @default(0)
  errorSummary   String?
  idempotencyKey String?      @unique
  createdById    String
  createdAt      DateTime     @default(now())
  completedAt    DateTime?

  business  Business            @relation(fields: [businessId], references: [id], onDelete: Cascade)
  file      FileUpload?         @relation(fields: [fileId], references: [id], onDelete: SetNull)
  createdBy User                @relation(fields: [createdById], references: [id])
  rows      CustomerImportRow[]
  customers Customer[]

  @@index([businessId, status])
}

model CustomerImportRow {
  id                String          @id @default(uuid())
  importId          String
  rowNumber         Int
  rawName           String?
  rawPhone          String?
  rawEmail          String?
  rawGender         String?
  rawDob            String?
  rawCity           String?
  rawAddress        String?
  normalizedName    String?
  normalizedPhone   String?
  normalizedEmail   String?
  normalizedGender  Gender?
  normalizedDob     DateTime?
  normalizedCity    String?
  normalizedAddress String?
  status            ImportRowStatus @default(VALID)
  validationErrors  Json?           // Array of error messages
  isDuplicate       Boolean         @default(false)
  duplicateReason   String?         // e.g. "Existing customer in business", "Duplicate row #12 in file"

  import CustomerImport @relation(fields: [importId], references: [id], onDelete: Cascade)

  @@index([importId, status])
}
```

---

## 3. Authentication, Sessions & Token Lifecycle

### 3.1 Cryptographic & Token Design
- **Password Hashing:** Argon2id via `argon2` npm package (`argon2.hash()`, `argon2.verify()`).
- **Access Tokens:** Short-lived JWT (15 minutes). Signed with `JWT_ACCESS_SECRET`. Contains:
  ```typescript
  export interface JwtPayload {
    sub: string;             // User UUID
    phone: string;           // E.164 Phone
    systemRole: 'USER' | 'SUPER_ADMIN';
    businessId?: string;     // Active Store UUID
    businessRole?: 'OWNER' | 'STAFF';
    sessionId: string;       // UserSession UUID
  }
  ```
- **Refresh Tokens:** Long-lived JWT (7 days). Signed with `JWT_REFRESH_SECRET`. Stored as an Argon2 hash in `UserSession.refreshTokenHash`.

### 3.2 Token Rotation & Reuse Attack Mitigation
Located in `AuthService.refreshTokens()` (`src/modules/auth/auth.service.ts:251-324`):
1. Client presents refresh token to `POST /api/v1/auth/refresh`.
2. Backend decodes `sessionId` and fetches `UserSession`.
3. If session is missing, expired, or marked `isRevoked: true` $\rightarrow$ Throws `401 Unauthorized (SESSION_EXPIRED)`.
4. Backend verifies presented token against stored `refreshTokenHash`:
   - If hash mismatch detected (token reuse attack!) $\rightarrow$ Immediately marks `isRevoked: true` and throws `401 TOKEN_REUSE_DETECTED`.
5. If valid, generates a new Access Token + new Refresh Token pair, updates `UserSession.refreshTokenHash` with the new hash, and returns the tokens.

### 3.3 Atomic Store Owner Onboarding
When an owner registers via `POST /api/v1/auth/register`, `AuthService.registerOwner()` executes a single atomic PostgreSQL transaction:
1. Normalizes owner mobile phone.
2. Creates `User` record (`systemRole: USER`).
3. Creates `Business` record.
4. Creates `BusinessUser` relationship (`role: OWNER`).
5. Generates 7 default `BusinessHours` records (10:00 - 21:00 Monday–Saturday, Sunday closed).
6. Creates initial `UserSession` and returns tokens.

---

## 4. Business Profile, Operating Schedule & Storage Subsystem

### 4.1 7-Day Operating Schedule Matrix
Managed by `BusinessService` (`src/modules/business/business.service.ts`).
- **Endpoint:** `PUT /api/v1/business/hours`
- **Validation Rules:**
  1. All 7 days of the week (`dayOfWeek: 0..6`) must be explicitly present in the request array.
  2. If `isClosed: false`, both `openTime` and `closeTime` (format `HH:mm`) are mandatory.
  3. `openTime` must be strictly earlier than `closeTime`.
  4. Updates are applied atomically in a transaction using `upsert`.

### 4.2 Object Storage Integration (Cloudflare R2)
Managed by `StorageService` (`src/modules/storage/storage.service.ts`) using AWS S3 SDK v3:
- **Logo Storage Key Pattern:** `businesses/{businessId}/logo/{uuid}.{ext}`
- **Import File Key Pattern:** `businesses/{businessId}/imports/{uuid}.{ext}`
- **Security:** R2 bucket is private. Logos and files are served using secure Pre-Signed URLs with expiration times (`getSignedDownloadUrl()`).

---

## 5. Customer Management & Canonical Phone Normalizer

### 5.1 Canonical Phone Normalizer Engine (`PhoneNormalizer`)
Located at `src/common/utils/phone-normalizer.util.ts`. Powered by `google-libphonenumber`.

```
Raw Phone Input (e.g. "98765 43210", "09876543210", "+91-9876543210")
                     |
                     v
             [ Clean Non-Digits ]
                     |
                     v
         [ Check Region Prefix (IN / +91) ]
                     |
                     v
         [ Valid 10-Digit Mobile Check (6,7,8,9 start) ]
                     |
                     +---> Invalid? ---> { isValid: false, error: "..." }
                     |
                     +---> Valid?   ---> { isValid: true, normalized: "+919876543210" }
```

### 5.2 Duplicate Prevention & Customer Restoration
In `CustomersService.create()` (`src/modules/customers/customers.service.ts:30-145`):
1. If an active customer (`deletedAt: null`) with `normalizedPhone` exists in `businessId` $\rightarrow$ Throws `409 Conflict (DUPLICATE_CUSTOMER)`.
2. If a soft-deleted customer (`deletedAt != null`) exists with `normalizedPhone` $\rightarrow$ **Restores the record**:
   - Sets `deletedAt = null`.
   - Updates name, email, DOB, address.
   - Upserts `CustomerCommunicationPreferences` with `consentSource = 'MANUAL_RESTORE'`.
   - Invalidates tenant analytics cache.
3. If new, creates `Customer` + `CustomerCommunicationPreferences` (all consents defaulting to `false`).

---

## 6. Staged Customer Import Pipeline (CSV, Excel & AI Vision)

```
+-----------------------------------------------------------------------------------------+
|                               STAGED BULK IMPORT PIPELINE                               |
|                                                                                         |
|  1. UPLOAD PHASE:                                                                       |
|     - POST /customers/import/file (CSV, XLSX, XLS <= 10MB)                              |
|     - POST /customers/import/image (JPEG, PNG, WebP <= 10MB -> Gemini Vision OCR)       |
|     - Uploaded to Cloudflare R2 -> Creates CustomerImport (Status: PENDING/PARSING)     |
|                                                                                         |
|  2. STAGING & PARSING PHASE (Asynchronous Worker):                                      |
|     - Rows parsed & mapped -> Normalized Phone, Name, Gender, DOB                       |
|     - Duplicate Checking:                                                               |
|         * Database Duplicate Check (against active store customers)                     |
|         * Intra-File Duplicate Check (against earlier rows in same file)                 |
|     - Creates CustomerImportRow records (Status: VALID | INVALID | DUPLICATE)           |
|     - CustomerImport updated to PREVIEW_READY                                           |
|                                                                                         |
|  3. PREVIEW PHASE:                                                                      |
|     - GET /customers/import/:id/rows?status=VALID&page=1                                |
|     - Merchant inspects valid vs invalid vs duplicate rows on mobile app before saving   |
|                                                                                         |
|  4. CONFIRMATION PHASE:                                                                 |
|     - POST /customers/import/:id/confirm (Idempotency-Key support)                      |
|     - Batch inserts all VALID rows into Customer table in atomic transaction            |
|     - Creates CustomerCommunicationPreferences for each customer                        |
|     - Sets CustomerImport status to COMPLETED                                           |
|     - Invalidates Analytics Redis Cache                                                 |
+-----------------------------------------------------------------------------------------+
```

### 6.1 Supported Import Types & Validation Rules
- **CSV (`ImportType.CSV`):** Streamed parsing via `csv-parse`. Handles flexible header aliases (`Phone`, `Mobile`, `Contact Number`, `Customer Name`, etc.).
- **Excel (`ImportType.EXCEL`):** Sheet parsing via `xlsx`. Automatically parses date cells and serial numbers.
- **AI Vision (`ImportType.IMAGE`):** Optical Character Recognition via Google Gemini Vision (`gemini-3.1-flash-lite`). Extracts tabular customer ledgers from handwritten or printed store notebooks. **All AI OCR output is marked untrusted** and must pass phone normalization and duplicate checks in the staging table.

---

## 7. Super Admin Cross-Tenant Inspection Subsystem

Super Admin endpoints reside in `AdminController` (`src/modules/admin/admin.controller.ts`) under `/api/v1/admin/*`. Protected by `JwtAuthGuard` and `RolesGuard(SystemRole.SUPER_ADMIN)`.

```
========================================================================================
SUPER ADMIN FEATURE 01 CAPABILITIES
========================================================================================
```

| Route | Purpose | Key Data Returned |
|---|---|---|
| `GET /api/v1/admin/dashboard` | Platform metrics overview | `totalBusinesses`, `totalUsers`, `totalCustomers`, `totalImports`, `completedImports`, `failedImports`, `totalFiles` |
| `GET /api/v1/admin/businesses` | Cross-tenant merchant directory | Paginated businesses, store owner contact info, total customer counts, import counts |
| `GET /api/v1/admin/businesses/:id` | Deep inspection of a merchant | Store profile, registered staff/owner members, 7-day schedule, file storage metrics |
| `GET /api/v1/admin/businesses/:id/customers` | Cross-tenant customer audit | Paginated customer directory for a specific store with marketing consent statuses |
| `GET /api/v1/admin/imports` | Global import audit logs | Platform-wide import log across all stores with creator details and file sizes |
| `GET /api/v1/admin/imports/:id` | Detailed import job breakdown | Row counts, failure summaries, file metadata, creator user details |

---

## 8. Complete API Specification & Request/Response Contracts

### 8.1 Authentication APIs (`/api/v1/auth/*`)

#### 1. Register Store Owner & Initialize Business
- **Route:** `POST /api/v1/auth/register` (Public)
- **Request Body:**
  ```json
  {
    "phone": "9876543210",
    "password": "Password123!",
    "name": "Aarav Mehta",
    "businessName": "Mehta Menswear",
    "businessAddress": "12 Mahatma Gandhi Road",
    "businessCity": "Mumbai",
    "businessState": "Maharashtra",
    "businessPincode": "400001",
    "businessEmail": "aarav@mehtamenswear.com"
  }
  ```
- **Response (`201 Created`):**
  ```json
  {
    "success": true,
    "data": {
      "user": {
        "id": "user-uuid",
        "phone": "+919876543210",
        "name": "Aarav Mehta",
        "systemRole": "USER"
      },
      "business": {
        "id": "business-uuid",
        "name": "Mehta Menswear",
        "role": "OWNER"
      },
      "tokens": {
        "accessToken": "jwt-access-token",
        "refreshToken": "jwt-refresh-token",
        "expiresIn": 900
      }
    }
  }
  ```

#### 2. Login
- **Route:** `POST /api/v1/auth/login` (Public, Status `200 OK`)
- **Request Body:** `{ "phone": "9876543210", "password": "Password123!", "deviceInfo": "iPhone 15 Pro" }`
- **Response (`200 OK`):** User profile, business membership, and token pair.

#### 3. Refresh Tokens
- **Route:** `POST /api/v1/auth/refresh` (Public, Status `200 OK`)
- **Request Body:** `{ "refreshToken": "jwt-refresh-token" }`
- **Response (`200 OK`):** Rotated token pair `{ "accessToken": "...", "refreshToken": "...", "expiresIn": 900 }`.

#### 4. Logout Session
- **Route:** `POST /api/v1/auth/logout` (JWT Guard, Status `200 OK`)
- **Response (`200 OK`):** `{ "message": "Logged out successfully" }`.

---

### 8.2 Business Profile & Hours APIs (`/api/v1/business/*`)
Guarded by `JwtAuthGuard`, `TenantGuard`.

#### 1. Get Profile
- **Route:** `GET /api/v1/business`
- **Response (`200 OK`):** Store details, 7-day schedule array, and pre-signed `logoUrl`.

#### 2. Update Profile
- **Route:** `PATCH /api/v1/business`
- **Request Body:** Partial profile fields (`name`, `phone`, `address`, `city`, `pincode`, `instagram`, `facebook`, `description`).

#### 3. Upload Logo
- **Route:** `POST /api/v1/business/logo` (`multipart/form-data`)
- **File Constraints:** JPEG, PNG, WebP $\le$ 5MB.
- **Response (`200 OK`):** `{ "logoKey": "...", "logoUrl": "https://..." }`.

#### 4. Upsert 7-Day Hours
- **Route:** `PUT /api/v1/business/hours`
- **Request Body:**
  ```json
  {
    "hours": [
      { "dayOfWeek": 0, "openTime": null, "closeTime": null, "isClosed": true },
      { "dayOfWeek": 1, "openTime": "10:00", "closeTime": "21:00", "isClosed": false },
      { "dayOfWeek": 2, "openTime": "10:00", "closeTime": "21:00", "isClosed": false },
      { "dayOfWeek": 3, "openTime": "10:00", "closeTime": "21:00", "isClosed": false },
      { "dayOfWeek": 4, "openTime": "10:00", "closeTime": "21:00", "isClosed": false },
      { "dayOfWeek": 5, "openTime": "10:00", "closeTime": "21:00", "isClosed": false },
      { "dayOfWeek": 6, "openTime": "10:00", "closeTime": "21:00", "isClosed": false }
    ]
  }
  ```

---

### 8.3 Customer Management APIs (`/api/v1/customers/*`)

#### 1. Create Customer Manually
- **Route:** `POST /api/v1/customers`
- **Request Body:**
  ```json
  {
    "name": "Rohan Sharma",
    "phone": "9876500001",
    "email": "rohan@example.com",
    "gender": "MALE",
    "dob": "1995-05-15",
    "city": "Mumbai",
    "preferences": {
      "whatsappMarketing": true,
      "voiceMarketing": false,
      "emailMarketing": true,
      "doNotContact": false
    }
  }
  ```
- **Response (`201 Created`):** Created `Customer` object with nested `preferences`.

#### 2. Search & List Customers (Paginated)
- **Route:** `GET /api/v1/customers?search=Rohan&whatsappMarketing=true&page=1&limit=20`
- **Response (`200 OK`):** `{ "data": [ ... ], "meta": { "total": 1, "page": 1, "limit": 20, "totalPages": 1 } }`.

#### 3. Get / Update / Soft-Delete Customer
- `GET /api/v1/customers/:id` $\rightarrow$ Returns customer details.
- `PATCH /api/v1/customers/:id` $\rightarrow$ Updates customer contact details and consent preferences.
- `DELETE /api/v1/customers/:id` $\rightarrow$ Sets `deletedAt` timestamp (Soft Delete).

---

### 8.4 Customer Import APIs (`/api/v1/customers/import/*`)

#### 1. Upload File / Image
- `POST /api/v1/customers/import/file` (`multipart/form-data`, `.csv`, `.xlsx`, `.xls` $\le$ 10MB)
- `POST /api/v1/customers/import/image` (`multipart/form-data`, JPEG/PNG/WebP $\le$ 10MB)
- **Response (`202 Accepted`):** `{ "importId": "import-uuid", "status": "PARSING" }`.

#### 2. Import Status & Rows Preview
- `GET /api/v1/customers/import/:id` $\rightarrow$ Returns counts: `totalRows`, `validRows`, `invalidRows`, `duplicateRows`, and `status`.
- `GET /api/v1/customers/import/:id/rows?status=VALID&page=1&limit=50` $\rightarrow$ Paginated preview of staged customer records with error annotations.

#### 3. Confirm Import
- **Route:** `POST /api/v1/customers/import/:id/confirm`
- **Header:** `Idempotency-Key: <key>`
- **Request Body:** `{ "skipDuplicates": true }`
- **Response (`200 OK`):** `{ "importId": "...", "status": "COMPLETED", "importedCount": 45 }`.

---

## 9. Security, RBAC & Multi-Tenant Isolation

### 9.1 Tenant Guard Protection
In `TenantGuard` (`src/common/guards/tenant.guard.ts`):
```typescript
@Injectable()
export class TenantGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user as AuthenticatedUser | undefined;

    if (!user) throw new ForbiddenException('User is not authenticated');
    if (user.systemRole === 'SUPER_ADMIN') return true;
    if (!user.businessId) {
      throw new ForbiddenException('Access denied: User does not belong to any active business tenant');
    }
    return true;
  }
}
```

### 9.2 Data Layer Defense-in-Depth
- Store owner controller routes resolve tenant context strictly through `@CurrentBusinessId()`, which extracts `req.user.businessId` set during JWT validation.
- All Prisma database queries (`Customer`, `BusinessHours`, `CustomerImport`, `FileUpload`) filter with `where: { businessId }`.

---

## 10. Automated Test Matrix & Verification Suites

### 10.1 Unit Test Coverage
- **`auth.service.spec.ts`:** Registration hashing, login verification, token rotation, token reuse revocation, session revocation.
- **`customers.service.spec.ts`:** Customer creation, E.164 normalization, soft-delete, customer restoration, duplicate phone prevention.
- **`customer-imports.service.spec.ts`:** CSV parsing, duplicate row detection, staged preview, idempotent batch insert.
- **`phone-normalizer.util.spec.ts`:** 10-digit validation, country code handling, invalid formats rejection.
- **`tenant.guard.spec.ts`:** Store tenant validation and Super Admin bypass.

### 10.2 End-to-End Test Coverage (`test/feature-01.e2e-spec.ts`)
26 test cases executing the complete production lifecycle:
1. Health check verification.
2. Owner registration, login, refresh token rotation, logout, and token revocation attack check.
3. Profile retrieval, profile update, and 7-day operating hours matrix validation.
4. Customer manual creation, phone normalization check, duplicate rejection, customer search, update, and soft deletion.
5. Staged import upload (CSV with duplicates and invalid entries), background parsing check, staged row preview, tenant isolation check, idempotent confirmation, and retry idempotency check.
6. Super Admin cross-tenant dashboard inspection, customer inspection, and regular merchant `403 Forbidden` RBAC rejection.

---

## 11. Developer Setup, Configuration & Troubleshooting

### 11.1 Environment Variables Checklist (`.env`)

```env
# Application
PORT=3000
NODE_ENV=development
API_PREFIX=api/v1
JWT_ACCESS_SECRET="your-32-char-jwt-access-secret-key!"
JWT_REFRESH_SECRET="your-32-char-jwt-refresh-secret-key!"

# PostgreSQL Database
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/sales_agent_db?schema=public"

# Cloudflare R2 Object Storage (S3-Compatible)
R2_ACCOUNT_ID="your-cloudflare-account-id"
R2_ACCESS_KEY_ID="your-r2-access-key-id"
R2_SECRET_ACCESS_KEY="your-r2-secret-access-key"
R2_BUCKET_NAME="sales-agent-bucket"
R2_PUBLIC_DOMAIN="https://r2.yourdomain.com"

# Google Gemini AI (Vision OCR)
GEMINI_API_KEY="your-gemini-api-key"
GEMINI_MODEL=gemini-3.1-flash-lite

# Super Admin Seed
SUPER_ADMIN_PHONE=+918148387156
SUPER_ADMIN_PASSWORD=saif@2005
SUPER_ADMIN_NAME="Platform Administrator"
```

### 11.2 Onboarding Commands for Developers

```bash
# 1. Install packages
npm install

# 2. Generate Prisma Client bindings
npx prisma generate

# 3. Start local database & cache containers
docker-compose up -d

# 4. Run database migrations
npx prisma migrate dev

# 5. Seed Super Admin user
npm run seed

# 6. Run full verification suite
npm test
npm run test:e2e

# 7. Launch development server with live reload
npm run start:dev
```
