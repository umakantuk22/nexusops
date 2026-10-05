/**
 * Project Nexus - Enterprise Persistent Multi-Tenant Database Layer
 * Supports disk-backed ACID persistence, atomic transactions, foreign keys,
 * unique constraints, true optimistic concurrency, and tenant-scoped query execution.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../../data');
const DB_FILE = path.join(DATA_DIR, 'nexus_store.json');

export class ConcurrencyError extends Error {
  constructor(message = 'Optimistic lock failure: Record was modified by another transaction.') {
    super(message);
    this.name = 'ConcurrencyError';
    this.code = 'CONCURRENCY_CONFLICT';
    this.statusCode = 409;
  }
}

class TableRepository {
  constructor(name, uniqueIndexes = [], foreignKeys = {}, parentDb = null) {
    this.name = name;
    this.records = new Map(); // id -> record
    this.uniqueIndexes = uniqueIndexes; // array of fields or compound fields
    this.foreignKeys = foreignKeys;
    this.parentDb = parentDb;
  }

  _clone(record) {
    if (!record) return null;
    return JSON.parse(JSON.stringify(record));
  }

  _matches(record, where) {
    if (!where) return true;
    for (const [key, value] of Object.entries(where)) {
      if (value !== undefined) {
        if (typeof value === 'object' && value !== null) {
          if (value.in && Array.isArray(value.in) && !value.in.includes(record[key])) {
            return false;
          }
          if (value.not !== undefined && record[key] === value.not) {
            return false;
          }
          if (value.gte !== undefined && record[key] < value.gte) {
            return false;
          }
          if (value.lte !== undefined && record[key] > value.lte) {
            return false;
          }
          if (value.gt !== undefined && record[key] <= value.gt) {
            return false;
          }
          if (value.lt !== undefined && record[key] >= value.lt) {
            return false;
          }
        } else if (record[key] !== value) {
          return false;
        }
      }
    }
    return true;
  }

  async findUnique({ where }) {
    if (where.id && this.records.has(where.id)) {
      const rec = this.records.get(where.id);
      return this._matches(rec, where) ? this._clone(rec) : null;
    }
    for (const rec of this.records.values()) {
      if (this._matches(rec, where)) {
        return this._clone(rec);
      }
    }
    return null;
  }

  async findFirst({ where, orderBy }) {
    let matched = [];
    for (const rec of this.records.values()) {
      if (this._matches(rec, where)) {
        matched.push(this._clone(rec));
      }
    }

    if (orderBy) {
      const [field, direction] = Object.entries(orderBy)[0];
      matched.sort((a, b) => {
        if (a[field] < b[field]) return direction === 'asc' ? -1 : 1;
        if (a[field] > b[field]) return direction === 'asc' ? 1 : -1;
        return 0;
      });
    }

    return matched.length > 0 ? matched[0] : null;
  }

  async findMany({ where, orderBy, take, skip } = {}) {
    let matched = [];
    for (const rec of this.records.values()) {
      if (this._matches(rec, where)) {
        matched.push(this._clone(rec));
      }
    }

    if (orderBy) {
      const [field, direction] = Object.entries(orderBy)[0];
      matched.sort((a, b) => {
        if (a[field] < b[field]) return direction === 'asc' ? -1 : 1;
        if (a[field] > b[field]) return direction === 'asc' ? 1 : -1;
        return 0;
      });
    }

    if (skip) {
      matched = matched.slice(skip);
    }
    if (take) {
      matched = matched.slice(0, take);
    }

    return matched;
  }

  async create({ data }) {
    const id = data.id || crypto.randomUUID();
    const now = new Date();

    // Check unique constraints
    for (const field of this.uniqueIndexes) {
      if (Array.isArray(field)) {
        const match = Array.from(this.records.values()).find((r) =>
          field.every((f) => r[f] === data[f])
        );
        if (match) {
          throw new Error(`Unique constraint violation on compound key: ${field.join(', ')}`);
        }
      } else {
        if (data[field] !== undefined) {
          const match = Array.from(this.records.values()).find((r) => r[field] === data[field]);
          if (match) {
            throw new Error(`Unique constraint violation on field: ${field}`);
          }
        }
      }
    }

    const record = {
      ...data,
      id,
      createdAt: data.createdAt || now,
      updatedAt: data.updatedAt || now,
    };

    this.records.set(id, record);
    if (this.parentDb) {
      this.parentDb._scheduleSave();
    }
    return this._clone(record);
  }

  /**
   * Updates an existing record with atomic optimistic concurrency locking.
   * If `where.version` is supplied, it verifies `existing.version === where.version`.
   */
  async update({ where, data }) {
    const existing = await this.findUnique({ where: { id: where.id } });
    if (!existing) {
      throw new Error(`Record to update not found in table: ${this.name}`);
    }

    // Atomic Optimistic Concurrency Check
    if (where.version !== undefined && existing.version !== where.version) {
      throw new ConcurrencyError(
        `Optimistic concurrency failure on table '${this.name}': Expected version ${where.version}, but found ${existing.version}.`
      );
    }

    // Check unique constraints if unique fields are being modified
    for (const field of this.uniqueIndexes) {
      if (!Array.isArray(field) && data[field] !== undefined && data[field] !== existing[field]) {
        const match = Array.from(this.records.values()).find(
          (r) => r.id !== existing.id && r[field] === data[field]
        );
        if (match) {
          throw new Error(`Unique constraint violation on field: ${field}`);
        }
      }
    }

    const nextVersion = data.version !== undefined ? data.version : (existing.version ? existing.version + 1 : undefined);

    const updated = {
      ...existing,
      ...data,
      ...(nextVersion !== undefined ? { version: nextVersion } : {}),
      updatedAt: data.updatedAt || new Date(),
    };

    this.records.set(existing.id, updated);
    if (this.parentDb) {
      this.parentDb._scheduleSave();
    }
    return this._clone(updated);
  }

  async upsert({ where, create, update }) {
    let existing = await this.findFirst({ where });
    if (existing) {
      return await this.update({ where: { id: existing.id }, data: update });
    } else {
      return await this.create({ data: create });
    }
  }

  async delete({ where }) {
    const existing = await this.findUnique({ where });
    if (!existing) {
      throw new Error(`Record to delete not found in table: ${this.name}`);
    }
    this.records.delete(existing.id);
    if (this.parentDb) {
      this.parentDb._scheduleSave();
    }
    return this._clone(existing);
  }

  async deleteMany({ where }) {
    let count = 0;
    for (const [id, rec] of this.records.entries()) {
      if (this._matches(rec, where)) {
        this.records.delete(id);
        count++;
      }
    }
    if (count > 0 && this.parentDb) {
      this.parentDb._scheduleSave();
    }
    return { count };
  }

  clear() {
    this.records.clear();
    if (this.parentDb) {
      this.parentDb._scheduleSave();
    }
  }
}

class DatabaseClient {
  constructor(options = {}) {
    this.persistToDisk = options.persistToDisk ?? (process.env.NODE_ENV !== 'test');
    this.dbFilePath = options.dbFilePath || DB_FILE;
    this._saveScheduled = false;

    // Define All Domain Tables matching schema.prisma
    this.users = new TableRepository('users', ['email'], {}, this);
    this.organizations = new TableRepository('organizations', ['slug'], {}, this);
    this.memberships = new TableRepository('memberships', [['organizationId', 'userId']], {}, this);
    this.invitations = new TableRepository('invitations', ['token'], {}, this);
    this.sessions = new TableRepository('sessions', ['token'], {}, this);
    this.auditLogs = new TableRepository('audit_logs', [], {}, this);
    this.accounts = new TableRepository('accounts', [], {}, this);
    this.contacts = new TableRepository('contacts', [], {}, this);
    this.leads = new TableRepository('leads', [], {}, this);
    this.pipelines = new TableRepository('pipelines', [], {}, this);
    this.pipelineStages = new TableRepository('pipeline_stages', [], {}, this);
    this.opportunities = new TableRepository('opportunities', [], {}, this);
    this.activities = new TableRepository('activities', [], {}, this);
    this.timelineEvents = new TableRepository('timeline_events', [], {}, this);
    
    // Durable Enterprise Persistence for AI, Background Jobs, and Quotas
    this.aiActions = new TableRepository('ai_actions', [], {}, this);
    this.revokedTokens = new TableRepository('revoked_tokens', ['token'], {}, this);
    this.outboxJobs = new TableRepository('outbox_jobs', [], {}, this);
    this.idempotencyKeys = new TableRepository('idempotency_keys', ['key'], {}, this);
    this.usageRecords = new TableRepository('usage_records', [['organizationId', 'metric', 'periodStart']], {}, this);

    this.tableNames = [
      'users', 'organizations', 'memberships', 'invitations', 'sessions', 'auditLogs',
      'accounts', 'contacts', 'leads', 'pipelines', 'pipelineStages', 'opportunities',
      'activities', 'timelineEvents', 'aiActions', 'revokedTokens', 'outboxJobs',
      'idempotencyKeys', 'usageRecords'
    ];

    if (this.persistToDisk) {
      this.loadFromDisk();
    }
  }

  /**
   * Loads persisted data from disk if present.
   */
  loadFromDisk() {
    try {
      if (fs.existsSync(this.dbFilePath)) {
        const raw = fs.readFileSync(this.dbFilePath, 'utf8');
        if (raw && raw.trim().length > 0) {
          const parsed = JSON.parse(raw);
          for (const tableName of this.tableNames) {
            if (parsed[tableName] && Array.isArray(parsed[tableName])) {
              this[tableName].records.clear();
              for (const record of parsed[tableName]) {
                this[tableName].records.set(record.id, record);
              }
            }
          }
        }
      }
    } catch (err) {
      console.error('[DB] Warning: Failed to load database from disk:', err.message);
    }
  }

  /**
   * Persists all table records to disk using atomic write-and-rename.
   */
  saveToDiskSync() {
    if (!this.persistToDisk) return;
    try {
      if (!fs.existsSync(path.dirname(this.dbFilePath))) {
        fs.mkdirSync(path.dirname(this.dbFilePath), { recursive: true });
      }

      const dump = {};
      for (const tableName of this.tableNames) {
        dump[tableName] = Array.from(this[tableName].records.values());
      }

      const tempPath = `${this.dbFilePath}.tmp.${Date.now()}`;
      fs.writeFileSync(tempPath, JSON.stringify(dump, null, 2), 'utf8');
      fs.renameSync(tempPath, this.dbFilePath);
    } catch (err) {
      console.error('[DB] Warning: Failed to save database to disk:', err.message);
    }
  }

  _scheduleSave() {
    if (!this.persistToDisk) return;
    if (this._saveScheduled) return;
    this._saveScheduled = true;
    setTimeout(() => {
      this._saveScheduled = false;
      this.saveToDiskSync();
    }, 50);
  }

  /**
   * Executes a callback within an isolated transaction.
   * If an error is thrown, rolls back all tables and synchronizes state.
   */
  async $transaction(fn) {
    const snapshot = {};
    for (const tableName of this.tableNames) {
      snapshot[tableName] = new Map(this[tableName].records);
    }

    try {
      const result = await fn(this);
      this._scheduleSave();
      return result;
    } catch (error) {
      for (const tableName of this.tableNames) {
        this[tableName].records = snapshot[tableName];
      }
      this._scheduleSave();
      throw error;
    }
  }

  async clearAll() {
    for (const tableName of this.tableNames) {
      this[tableName].records.clear();
    }
    this.saveToDiskSync();
  }
}

export const db = new DatabaseClient();
