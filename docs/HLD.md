# NexusOps — High-Level Design (HLD) Specification (v0.2.0)

## 1. Executive Overview & System Vision

NexusOps is an **AI-Native Revenue & Customer Operations Platform** engineered to eliminate repetitive administrative toil and bridge the gap between static customer databases and autonomous execution.

Unlike traditional CRMs that act merely as passive data stores ("Systems of Record"), Nexus operates as a tri-layer operational engine:

```
┌─────────────────────────────────────────────────────────────┐
│                       PROJECT NEXUS                         │
├──────────────────────────────┬──────────────────────────────┤
│ 1. SYSTEM OF RECORD          │ Relational customer state    │
│    (Accounts, Leads, Deals)  │ Multi-tenant PostgreSQL      │
├──────────────────────────────┼──────────────────────────────┤
│ 2. SYSTEM OF CONTEXT         │ Chronological event stream,  │
│    (Unified Timeline, Health)│ communications, AI context   │
├──────────────────────────────┼──────────────────────────────┤
│ 3. SYSTEM OF ACTION          │ Priority attention engine,   │
│    (Work Engine, AI Gateway) │ automated rules, approvals   │
└──────────────────────────────┴──────────────────────────────┘
```

The fundamental operating loop is:
```
Business Activity
        ↓
Authorized Signals (Email, Meetings, Webhooks)
        ↓
Unified Context (Sanitized & Fenced)
        ↓
Intelligence / Predictive Scoring
        ↓
Required Work Prioritization (Work Engine)
        ↓
AI Recommendation / Action Preparation
        ↓
Human Approval (When Risk >= Medium)
        ↓
Action Execution
        ↓
Updated Context & Immutable Audit
```

---

## 2. High-Level Architecture Diagram

```
                                  USER INTERFACE
                   Responsive Next.js / Tailwind Web Client
                    + Custom Ambient Luminous Pointer Accent
                                        │
                                        │ HTTP / JSON API / REST
                                        ▼
                                  API / BFF LAYER
                     Uniform Request Routing & Context Resolution
                     Health: /livez, /readyz | Metrics: /metrics
                                        │
                     ┌──────────────────┴──────────────────┐
                     ▼                                     ▼
        AUTHENTICATION & TENANCY                  REQUEST OBSERVABILITY
       Bearer JWT & Revocation Denylist        Request ID / Prometheus Metrics
                     │
                     ▼
          AUTHORIZATION (RBAC) & FIELD-LEVEL SECURITY (FLS)
         Verifies: Role Permissions, FLS Filtering, Strict Tenant Scope
                     │
    ┌────────────────┼────────────────┬───────────────────┐
    ▼                ▼                ▼                   ▼
CRM DOMAIN     WORK ENGINE      AI ACTION GATEWAY   AUTOMATION & OUTBOX
- Accounts     - Dynamic        - Typed Tool Reg.   - Domain Events
- Contacts       Priority       - Risk Classifier   - Workflow Rules
- Leads          Scoring        - Human Approvals   - Retry & Dead Letter
- Deals/Kanban - Attention      - Meeting Intel.    - Idempotency Store
- Deal Health    Queue          - Inbound Email     - Background Jobs
- CSV Import   - Unified Search - Context Engine
    │                │                │                   │
    └────────────────┼────────────────┴───────────────────┘
                     ▼
             APPLICATION SERVICE & REPOSITORY LAYER
          ACID Transactions, Foreign Keys, Concurrency
                     │
     ┌───────────────┴───────────────┐
     ▼                               ▼
POSTGRESQL / PRISMA DB          IMMUTABLE AUDIT LOG
Multi-tenant partitioned        Cryptographic, tamper-proof
Data layer with RLS             compliance audit trail
```

---

## 3. Core Architectural Subsystems

### 3.1. Identity, Multi-Tenancy & Authorization
* **Tenant Isolation:** Every tenant-owned database table includes a non-nullable `organizationId`. Queries are strictly scoped at the service level, supplemented by PostgreSQL Row-Level Security (RLS).
* **Cross-Tenant Guard:** The `assertTenantScope(activeTenantId, targetResourceTenantId)` function ensures no user can read, mutate, or delete records belonging to another organization.
* **Session Revocation Denylist:** Immediate invalidation of compromised tokens via `IdentityService.revokeSession(token)`.
* **Field-Level Security (FLS):** Restricts sensitive financial fields (such as deal values) from restricted roles (`VIEWER`).
* **RBAC Matrix:** Roles are organized hierarchically: `OWNER` > `ADMIN` > `MANAGER` > `MEMBER` > `VIEWER`. Actions require explicit permission tokens.

### 3.2. CRM Core Domain & Unified Timeline
* **Accounts:** Enterprise and mid-market organizations with Customer Health Scores (0–100%) and tier tags (`ENTERPRISE`, `MID_MARKET`, `SMB`).
* **Contacts:** Individuals associated with customer accounts.
* **Leads:** Inbound opportunities evaluated with lead scores. Supports single-click **atomic conversion** into an Account, Contact, and Opportunity in a single transaction.
* **Pipelines & Interactive Kanban:** Multi-stage sales funnels tracking deal values, stage probabilities, and Closed Won / Closed Lost transitions.
* **Predictive Deal Velocity:** Automated scans detecting stalled negotiations (>14 days in stage) and escalating churn alerts into the Work Engine.
* **CSV Import & Export:** Bulk tenant-isolated CSV ingestion and backup export.
* **Unified Timeline:** Every customer lifecycle signal (lead conversion, call completed, deal progressed, email sent) is automatically appended to a unified, chronological activity stream.

### 3.3. Work Engine (Attention Center)
Calculates an attention priority score (0–100) dynamically using multi-factor signals:
1. **Urgency:** Overdue tasks (+40), due today (+30), due in 3 days (+20).
2. **Business Impact:** Deal value > $100k (+25), Enterprise tier (+20).
3. **Customer Risk:** Low customer health < 50% (+25).
4. **Lead Quality:** Lead score >= 80 (+20).
5. **Human Approval:** Pending AI actions awaiting authorization (+45).

### 3.4. AI Security Model & Action Gateway
* **Typed Tool Registry:** AI interacts exclusively via defined tools with input schemas and risk levels.
* **Risk Tiers:**
  * `LOW`: Automatic execution (e.g., summarize record, draft internal note).
  * `MEDIUM` & `HIGH`: Gated behind human-in-the-loop authorization (e.g., update deal stage, delete account, send external email).
* **Meeting Intelligence:** Transcripts are analyzed to determine customer sentiment and automatically extract tasks.
* **Inbound Email Ingestion:** Emails are parsed, linked to Contacts/Accounts, and provided with AI-drafted replies.
* **Prompt Injection Defense:** External inputs (emails, attachments, webhook payloads) are treated as untrusted and wrapped in `<untrusted_content>` fences.

### 3.5. Automation, Outbox & Background Jobs
* **Transactional Outbox:** Ensures events are only committed to the background queue after the database transaction succeeds.
* **Idempotency Engine:** Prevents duplicate side-effects from webhooks or retries using unique idempotency keys.
* **Resilient Job Runner:** Supports 3 retry attempts with exponential backoff before routing failed jobs to a `DEAD_LETTER` queue.
* **Workflow Engine:** Evaluates domain events and executes automated actions.

### 3.6. Enterprise DevOps & Monitoring
* **Docker & Docker Compose:** Multi-container production stack (Nexus App, PostgreSQL 16, Redis 7).
* **CI/CD Automation:** GitHub Actions workflow running tests across Node 18, 20, and 22.
* **Observability:** Cloud health probes (`/livez`, `/readyz`) and Prometheus metrics (`/metrics`).
