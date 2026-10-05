# NexusOps — Low-Level Design (LLD) Specification (v0.2.0)

## 1. Domain Entities & Database Schema

The database is defined in `prisma/schema.prisma` and backed by the transactional repository engine in `src/lib/db.js`.

### 1.1. Core Identity & Tenancy
* **`Organization`**: `id` (UUID PK), `name` (String), `slug` (String, Unique), `plan` (Enum: FREE, PRO, ENTERPRISE), `createdAt`, `updatedAt`.
* **`User`**: `id` (UUID PK), `email` (String, Unique), `passwordHash` (String, PBKDF2), `name` (String), `createdAt`, `updatedAt`.
* **`Membership`**: `id` (UUID PK), `organizationId` (FK), `userId` (FK), `role` (Enum: OWNER, ADMIN, MANAGER, MEMBER, VIEWER), compound unique index on `[organizationId, userId]`.
* **`Invitation`**: `id` (UUID PK), `organizationId` (FK), `email` (String), `role` (Enum), `token` (String, Unique), `expiresAt`, `status` (PENDING, ACCEPTED, DECLINED, EXPIRED).
* **`AuditLog`**: `id` (UUID PK), `organizationId` (FK), `userId` (FK, Nullable), `action` (String), `entityType` (String), `entityId` (String), `details` (JSON), `ipAddress`, `userAgent`, `createdAt`.

### 1.2. CRM Entities
* **`Account`**: `id` (UUID PK), `organizationId` (FK), `name`, `industry`, `website`, `tier` (ENTERPRISE, MID_MARKET, SMB), `healthScore` (Integer 0–100), `version` (Integer, Optimistic Locking).
* **`Contact`**: `id` (UUID PK), `organizationId` (FK), `accountId` (FK, Nullable), `firstName`, `lastName`, `email`, `phone`, `title`, `version`.
* **`Lead`**: `id` (UUID PK), `organizationId` (FK), `firstName`, `lastName`, `email`, `company`, `status` (NEW, CONTACTED, QUALIFIED, UNQUALIFIED, CONVERTED), `score` (0–100), `source`, `convertedAccountId`, `convertedOpportunityId`, `version`.
* **`Pipeline`**: `id` (UUID PK), `organizationId` (FK), `name`, `isDefault` (Boolean).
* **`PipelineStage`**: `id` (UUID PK), `pipelineId` (FK), `name`, `order` (Int), `winProbability` (0–100), `isClosedWon` (Bool), `isClosedLost` (Bool).
* **`Opportunity`**: `id` (UUID PK), `organizationId` (FK), `accountId` (FK), `pipelineId` (FK), `stageId` (FK), `title`, `value` (Float), `currency` (String), `status` (OPEN, WON, LOST), `lostReason`, `version`.
* **`Activity`**: `id` (UUID PK), `organizationId` (FK), `userId` (FK), `entityType`, `entityId`, `type` (CALL, EMAIL, MEETING, NOTE, TASK), `subject`, `description`, `status` (PENDING, COMPLETED, CANCELLED), `dueDate`, `completedAt`.
* **`TimelineEvent`**: `id` (UUID PK), `organizationId` (FK), `entityType`, `entityId`, `eventType`, `summary`, `metadata` (JSON), `createdAt`.

---

## 2. Advanced Service Contracts

### 2.1. `MeetingIntelligenceService` (`src/modules/ai-context/meeting_intelligence.service.js`)
* `analyzeMeeting({ organizationId, userId, entityType, entityId, meetingTitle, transcript })`:
  * Fences transcript in `<untrusted_content>`.
  * Detects sentiment (`POSITIVE`, `NEUTRAL`, `RISK_OF_CHURN`).
  * Extracts action items and commitments.
  * Provisions follow-up tasks in `ActivityService`.
  * Records `MEETING_INTELLIGENCE_PROCESSED` on the unified timeline.

### 2.2. `EmailService` (`src/modules/communication/email.service.js`)
* `ingestEmail({ organizationId, fromEmail, toEmail, subject, body, threadId })`:
  * Matches inbound sender to existing `Contact` or `Lead`.
  * Fences body against prompt injection.
  * Logs `EMAIL_RECEIVED` to unified timeline.
  * Auto-generates AI reply draft via `ActionGatewayService`.
  * Creates an urgent review task in the Work Engine.

### 2.3. `DealHealthService` (`src/modules/crm/deal_health.service.js`)
* `scanStalledDeals(organizationId, daysThreshold = 14)`:
  * Detects open opportunities with no stage changes for > 14 days.
  * Escalates priority in the Work Engine.
* `scanChurnRisk(organizationId, healthThreshold = 50)`:
  * Scans accounts with health scores below threshold.

### 2.4. `CsvExportImportService` (`src/modules/crm/csv_export_import.service.js`)
* `importLeadsFromCsv({ organizationId, userId, csvContent })`: Schema-validated bulk intake.
* `exportAccountsToCsv(organizationId)`: Tenant-isolated CSV generation.

### 2.5. `IdentityService` Token Revocation
* `revokeSession(token)`: Adds token to revocation denylist.
* `verifySession(token)`: Checks denylist before signature parsing.

### 2.6. `AuthorizationService` Field-Level Security (FLS)
* `filterRestrictedFields(role, entityType, data)`: Strips sensitive columns (e.g. `value` on Opportunity) for unauthorized roles (`VIEWER`).

---

## 3. UI Luminous Ambient Pointer Architecture

Implemented in `public/index.html`:
* **Core Dot (`#nexusPointerDot`):** 8px circular element centered on `(mouseX, mouseY)` with a subtle light indigo shadow (`rgba(129, 140, 248, 0.75)`).
* **Ambient Halo (`#nexusPointerHalo`):** 32px radial gradient ring that follows the mouse using linear interpolation (lerp factor `0.18`) for smooth movement.
* **Magnetic Expansion:** Expands to 48px with intensified luminance when hovering over buttons, cards, links, or inputs (`body.is-hovering`).
* **Accessibility:** Automatically disabled on touchscreens (`@media (pointer: coarse)`).
