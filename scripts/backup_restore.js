/**
 * Project Nexus - Disaster Recovery, Backup & Point-in-Time Restore Engine
 * Supports automated snapshot creation, SHA-256 integrity validation, and atomic restore.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.resolve(__dirname, '../data/nexus_store.json');
const BACKUP_DIR = path.resolve(__dirname, '../backups');

export class BackupRestoreService {
  static createBackup() {
    if (!fs.existsSync(DATA_FILE)) {
      throw new Error(`Data file '${DATA_FILE}' does not exist.`);
    }

    if (!fs.existsSync(BACKUP_DIR)) {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(BACKUP_DIR, `nexus_backup_${timestamp}.json`);
    const checksumFile = `${backupFile}.sha256`;

    const rawData = fs.readFileSync(DATA_FILE, 'utf8');
    const hash = crypto.createHash('sha256').update(rawData).digest('hex');

    fs.writeFileSync(backupFile, rawData, 'utf8');
    fs.writeFileSync(checksumFile, hash, 'utf8');

    console.log(`[Backup] Snapshot created: ${backupFile}`);
    console.log(`[Backup] SHA-256 Checksum: ${hash}`);

    return { backupFile, checksum: hash, timestamp };
  }

  static restoreBackup(backupFilePath) {
    if (!fs.existsSync(backupFilePath)) {
      throw new Error(`Backup file '${backupFilePath}' not found.`);
    }

    const checksumFile = `${backupFilePath}.sha256`;
    if (fs.existsSync(checksumFile)) {
      const expectedHash = fs.readFileSync(checksumFile, 'utf8').trim();
      const rawData = fs.readFileSync(backupFilePath, 'utf8');
      const actualHash = crypto.createHash('sha256').update(rawData).digest('hex');

      if (expectedHash !== actualHash) {
        throw new Error('Integrity check failed: Backup file checksum does not match!');
      }
      console.log('[Restore] Checksum verified successfully.');
    }

    // Atomic restore
    const tempFile = `${DATA_FILE}.restore.tmp`;
    fs.copyFileSync(backupFilePath, tempFile);
    fs.renameSync(tempFile, DATA_FILE);

    console.log(`[Restore] Database successfully restored from '${backupFilePath}'.`);
    return { success: true, restoredFrom: backupFilePath };
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2] || 'backup';
  if (mode === 'backup') {
    BackupRestoreService.createBackup();
  } else if (mode === 'restore') {
    const target = process.argv[3];
    if (!target) {
      console.error('Usage: node scripts/backup_restore.js restore <path_to_backup.json>');
      process.exit(1);
    }
    BackupRestoreService.restoreBackup(target);
  }
}
