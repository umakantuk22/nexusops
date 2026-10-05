# NexusOps — Security, Hardening & Disaster Recovery Architecture

This document outlines the production-hardened infrastructure, security controls, and operational disaster recovery policies implemented across **NexusOps**.

---

## 1. Database Architecture & Persistence Strategy

### Transition from In-Memory to Persistent Storage
- **PostgreSQL 16 & Prisma Engine**: The canonical production schema is codified in `prisma/schema.prisma` and deployed via version-controlled SQL migrations (`prisma/migrations/20261005000000_init/migration.sql`).
- **Disk-Backed ACID Engine (`src/lib/db.js`)**: In environments without active database daemons, NexusOps persists all table states to `data/nexus_store.json` using atomic write-and-rename semantics (`tmp.<timestamp>` -> atomic `fs.renameSync`).
- **No Destructive Seeding**: Normal server startup (`src/server/index.js`) checks for existing tenant records and skips seeding if data exists. Re-seeding requires explicit opt-in via `npm run db:seed -- --force`.
- **Atomic Concurrency (Optimistic Locking)**: Repositories enforce optimistic locking using `where.version === existing.version` and atomic increments, throwing `ConcurrencyError` (HTTP 409 Conflict) on collision.

---

## 2. Authentication & Session Hardening

### Secret Validation & Production Gatekeeper
- **Fail-Fast Startup**: In `NODE_ENV=production`, `src/config/env.js` strictly forbids fallback secrets. If `JWT_SECRET` is unset, empty, or uses development defaults, the server terminates immediately with a fatal exit code.
- **Distributed Token Revocation Denylist**: When a session is terminated (`/api/v1/auth/logout` or `IdentityService.revokeSession`), the token is written to `db.revokedTokens`. Every request validates against both a fast local Set and the durable table, preventing session replay across multi-instance clusters.

---

## 3. Defense-in-Depth & Network Hardening

### Request Size Limits & Buffer Overload Protection
- **Body Guard (`src/server/index.js`)**: Streaming body reader enforces a strict 1MB threshold for JSON payloads and 10MB threshold for CSV uploads. Exceeding payloads are terminated with **HTTP 413 (Payload Too Large)** before parsing.
- **Malformed JSON Protection**: Malformed JSON inputs fail gracefully with HTTP 400 Bad Request without crashing the worker process.

### Rate Limiting & Anti-Brute Force Protection
- **Sliding-Window Limiter (`src/middleware/rate_limiter.middleware.js`)**:
  - `POST /api/v1/auth/login`: Maximum 10 attempts per minute per IP.
  - `POST /api/v1/auth/register`: Maximum 10 attempts per minute per IP.
  - General API endpoints: Maximum 120 requests per minute.
  - Exceeded limits return **HTTP 429 (Too Many Requests)** with `Retry-After` headers.

### Information Leakage Prevention
- **Kubernetes Health Probes**:
  - `GET /livez`: Returns HTTP 200 `OK`.
  - `GET /readyz`: Pings database readiness; returns `{ status: "ready", checks: { database: "ok" } }` without exposing internal business counts or tenant counts.

---

## 4. AI Action Gateway & Safety Protocols

### Risk Classification & Approvals
- **Risk Tiers**: `LOW`, `MEDIUM`, `HIGH`, `CRITICAL`.
- **Approval Expiration**: Every approval request is assigned a strict 48-hour expiration (`expiresAt`). Once expired, actions transition to `EXPIRED` and cannot be approved.
- **Execution-Time Re-validation**: Permissions are re-checked at the exact moment of execution, guaranteeing that permissions revoked between request and approval are respected.
- **Separation of Duties (SoD)**: For `CRITICAL` tools and high-risk workflows, the requesting user cannot self-approve their own request (`requesterId !== approverId`).
- **Idempotency**: All AI actions support client-supplied or auto-generated `idempotencyKey` strings persisted to `db.idempotencyKeys`.

---

## 5. Cryptographically Chained Audit Trail

### SHA-256 Hash Chaining
- Each audit log entry calculates:
  $$\text{eventHash} = \text{SHA256}(\text{previousHash} \parallel \text{timestamp} \parallel \text{organizationId} \parallel \text{action} \parallel \text{details})$$
- `AuditService.verifyAuditIntegrity(organizationId)` scans the entire tenant log sequence to mathematically prove that no audit records have been inserted, deleted, or modified.

### PII & Secret Redaction
- Fields matching sensitive keywords (`password`, `token`, `secret`, `jwt`, `apiKey`, `creditCard`, `ssn`) are automatically sanitized to `[REDACTED]` prior to logging.

---

## 6. Disaster Recovery & Backup Runbook

### Recovery Metrics
- **RPO (Recovery Point Objective)**: < 5 minutes via atomic snapshots.
- **RTO (Recovery Time Objective)**: < 15 minutes to restore state and verify health.

### Backup Commands
```bash
# Create an on-demand snapshot with SHA-256 verification
npm run db:backup

# Restore database from snapshot
npm run db:restore -- backups/nexus_backup_<timestamp>.json
```
