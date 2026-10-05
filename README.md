# NexusOps — AI-Native Revenue & Customer Operations Platform

NexusOps is an **AI-Native Revenue & Customer Operations Platform** that unifies a **System of Record**, **System of Context**, and **System of Action** into a single cohesive platform.

---

## 🚀 Quickstart: How to Run Locally on Your PC

NexusOps is designed to run locally with **zero external package installations or database configuration**. The production-grade disk-backed persistence engine and demo fixtures run directly inside Node.js.

### Prerequisites
* **Node.js** (Version 18 or higher) installed on your computer.
  * If you don't have it, download and install the LTS version from [nodejs.org](https://nodejs.org/).

---

### Step 1: Open Terminal / Command Prompt in the Project Folder
* **Windows:** Open the folder in File Explorer, click the address bar at the top, type `cmd`, and press `Enter`.
* **macOS / Linux:** Open Terminal, type `cd `, drag the project folder into the terminal window, and press `Enter`.

---

### Step 2: Start the NexusOps Server
Run this single command in your terminal:
```bash
npm start
```
*(Alternatively, you can run: `node src/server/index.js`)*

You will see output indicating the server is running:
```text
[INFO] NexusOps Server listening on http://localhost:3000
```

---

### Step 3: Open in Your Browser
Open Chrome, Edge, Safari, or Firefox and go to:
👉 **[http://localhost:3000](http://localhost:3000)**

*(Alternatively, you can double-click `START-HERE-NEXUS-DASHBOARD.html` or `public/index.html` to run in local offline mode.)*

---

## 🛡️ Production Hardening & Architectural Upgrades

In response to executive architectural review, NexusOps has been hardened from prototype to production SaaS infrastructure:

1. **Durable ACID Persistence Engine (`src/lib/db.js`)**:
   - Replaced pure in-memory state with a disk-backed, atomic write-and-rename persistence engine storing state in `data/nexus_store.json`.
   - True atomic optimistic concurrency locking (`where.version === existing.version` with auto-increment), returning `ConcurrencyError` (HTTP 409 Conflict) on collision.
   - Non-destructive startup: existing data is preserved across restarts. Re-seeding requires explicit opt-in: `npm run db:seed -- --force`.

2. **Database Migrations & PostgreSQL 16 (`prisma/migrations/`)**:
   - Production PostgreSQL 16 schema codified in `prisma/schema.prisma`.
   - Version-controlled SQL migration script provided in `prisma/migrations/20261005000000_init/migration.sql`.

3. **Complete REST API v1 Surface (`src/api/v1/router.js`)**:
   - Full REST endpoints for Accounts, Contacts, Leads, Lead Conversion, Opportunities, Stalled Deals, Activities, Timeline, Work Queue, Global Search, AI Action Gateway, Billing Quotas, and Audit Logs.
   - Documented in OpenAPI 3.0 specification (`docs/openapi.yaml`).

4. **Frontend / Backend REST Integration (`public/index.html`)**:
   - Interactive UI actively communicates with backend endpoints via `fetch('/api/v1/...')` with automatic session token management.
   - Built-in graceful offline fallback when opened directly via `file://`.

5. **Security, Rate Limiting & DoS Protection**:
   - **Request Body Guard**: Strictly enforces a 1MB limit for JSON payloads and 10MB for CSV uploads, returning **HTTP 413 (Payload Too Large)** if exceeded.
   - **Sliding-Window Rate Limiter**: Restricts brute-force attempts on `/api/v1/auth/login` (10/min) and general API routes (120/min), returning **HTTP 429 (Too Many Requests)**.
   - **Production Secret Validation**: In `NODE_ENV=production`, the application terminates at startup if `JWT_SECRET` is missing or uses default development keys.

6. **Cryptographically Chained Audit Trail (`src/modules/audit/audit.service.js`)**:
   - SHA-256 hash chaining ($\text{hash}_N = \text{SHA256}(\text{hash}_{N-1} \parallel \text{event}_N)$) providing blockchain-grade tamper detection.
   - Automatic redaction of sensitive credentials (`password`, `token`, `secret`, `apiKey`) to `[REDACTED]`.
   - Integrity verification endpoint: `GET /api/v1/audit/verify`.

7. **AI Action Gateway Safety Protocols (`src/modules/ai-gateway/`)**:
   - **Separation of Duties (SoD)**: Requester cannot self-approve high-risk or critical actions (`requesterId !== approverId`).
   - **Approval Expiry**: Pending approval requests automatically expire after 48 hours.
   - **Execution-Time Re-validation**: Re-evaluates permissions and tenant scoping at execution time.
   - **Idempotency**: Prevents duplicate executions with durable idempotency keys (`db.idempotencyKeys`).

8. **Transactional Outbox & Monthly Billing**:
   - Background jobs durably queued in `db.outboxJobs` with retries, exponential backoff, and dead-letter queue.
   - Monthly billing quota tracking persisted to `db.usageRecords` partitioned by calendar month windows.

9. **Disaster Recovery & Point-in-Time Restore**:
   - CLI backup and restore scripts with SHA-256 checksum verification:
     ```bash
     npm run db:backup
     npm run db:restore -- backups/nexus_backup_<timestamp>.json
     ```

---

## 🎨 Luminous Ambient Pointer Accent
When viewing the interface on desktop, NexusOps features a **custom luminous ambient pointer** (`#nexusPointerDot` & `#nexusPointerHalo`). The pointer glides smoothly across the dark slate background and magnetically expands when hovering over interactive cards, buttons, and inputs. On mobile/touchscreens, it seamlessly falls back to standard touch controls.

---

## 🧪 Running Automated Tests

To run the complete automated test suite:

```bash
npm test
```

This executes all **21 automated test suites** with 100% pass rate:
* `tests/unit/crypto.test.js` — Password hashing & JWT tamper detection
* `tests/unit/authorization.test.js` — RBAC permissions & role hierarchy
* `tests/unit/work_engine.test.js` — Dynamic multidimensional priority scoring
* `tests/unit/automation.test.js` — Transactional outbox, retries & dead-letter queue
* `tests/unit/entitlements.test.js` — Plan limits & monthly quota enforcement
* `tests/unit/meeting_and_email.test.js` — AI sentiment & task extraction
* `tests/unit/deal_health.test.js` — Predictive deal velocity & stalled pipeline detection
* `tests/unit/csv_and_fls.test.js` — CSV bulk ingestion & Field-Level Security
* `tests/integration/identity_and_org.test.js` — Multi-tenant organization lifecycle
* `tests/integration/crm_domain.test.js` — Atomic lead conversion & optimistic concurrency
* `tests/security/tenant_isolation.test.js` — Cross-tenant boundary attack prevention
* `tests/security/ai_gateway_security.test.js` — Prompt injection defense & risk approval flow
* `tests/security/production_hardening.test.js` — Rate limits, body size guards, audit chaining & REST API

---

## 📚 Architectural Documentation

* **[OpenAPI 3.0 Specification](docs/openapi.yaml)** — Full REST API contract.
* **[Security & Disaster Recovery Architecture](docs/SECURITY_AND_DISASTER_RECOVERY.md)** — Production hardening, RPO/RTO runbook, and compliance controls.
* **[High-Level Design (HLD)](docs/HLD.md)** — Subsystems, data flow, security model, and scaling.
* **[Low-Level Design (LLD)](docs/LLD.md)** — Entity schemas, service signatures, state machines, and formulas.
* **[Google Drive Review Document](https://docs.google.com/document/d/1YeAn3SuKwAuqjB8ad3GKzqV7seNG4BPBPbc6Gl3pwNE/edit)** — Live Google Doc overview.
