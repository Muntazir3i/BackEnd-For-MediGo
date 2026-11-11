/**
 * Database backup and restore.
 *
 * Backups are written with SQLite's online backup API so they are consistent
 * even while the shop is billing. A restore is prepared as a pending file and
 * applied on the next backend start; that avoids swapping the database file
 * underneath live prepared statements.
 */
import fs from 'fs';
import path from 'path';
import db from '../db/billPayment.js';

const databasePath = path.resolve(process.env.DB_PATH || 'billsNpayment.db');
const backupDir = path.resolve('backups');
const pendingRestorePath = `${databasePath}.pending-restore`;
const pendingMarkerPath = `${pendingRestorePath}.json`;
const AUTO_BACKUP_HOUR = 21;
const AUTO_BACKUP_KEEP = 30;
const BACKUP_NAME_PATTERN = /^(auto|manual|pre-restore)-\d{8}-\d{6}\.db$/;

let scheduler = null;

function pad(value) {
  return String(value).padStart(2, '0');
}

function stamp(date = new Date()) {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function ensureBackupDir() {
  fs.mkdirSync(backupDir, { recursive: true });
}

function parseBackupName(name) {
  const match = /^(auto|manual|pre-restore)-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.db$/.exec(name);
  if (!match) return null;

  const [, type, year, month, day, hour, minute, second] = match;
  const createdAt = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second)
  );

  return { type, createdAt };
}

function sizeLabel(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export function getBackupPath(name) {
  if (!BACKUP_NAME_PATTERN.test(String(name || ''))) {
    throw new Error('Invalid backup name');
  }

  const filePath = path.join(backupDir, name);
  if (!fs.existsSync(filePath)) {
    throw new Error('Backup not found');
  }

  return filePath;
}

export function listBackups() {
  ensureBackupDir();

  return fs
    .readdirSync(backupDir)
    .filter((name) => BACKUP_NAME_PATTERN.test(name))
    .map((name) => {
      const filePath = path.join(backupDir, name);
      const stat = fs.statSync(filePath);
      const parsed = parseBackupName(name);

      return {
        name,
        type: parsed?.type || 'manual',
        createdAt: parsed?.createdAt?.toISOString() || stat.mtime.toISOString(),
        sizeBytes: stat.size,
        sizeLabel: sizeLabel(stat.size)
      };
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export async function createBackup({ type = 'manual' } = {}) {
  ensureBackupDir();

  const safeType = type === 'auto' ? 'auto' : 'manual';
  const name = `${safeType}-${stamp()}.db`;
  const filePath = path.join(backupDir, name);

  await db.backup(filePath);

  const stat = fs.statSync(filePath);
  return {
    name,
    type: safeType,
    createdAt: new Date().toISOString(),
    sizeBytes: stat.size,
    sizeLabel: sizeLabel(stat.size)
  };
}

function pruneAutoBackups() {
  const autos = listBackups().filter((backup) => backup.type === 'auto');

  for (const backup of autos.slice(AUTO_BACKUP_KEEP)) {
    try {
      fs.unlinkSync(path.join(backupDir, backup.name));
    } catch (error) {
      console.error('Could not remove old auto backup:', error);
    }
  }
}

export async function prepareRestore(name) {
  const backupPath = getBackupPath(name);

  // Keep a safety copy of the live database before replacing it.
  const safety = await createBackup({ type: 'manual' });

  fs.copyFileSync(backupPath, pendingRestorePath);
  fs.writeFileSync(
    pendingMarkerPath,
    JSON.stringify(
      {
        requestedAt: new Date().toISOString(),
        backupName: name,
        safetyBackup: safety.name
      },
      null,
      2
    )
  );

  return {
    backupName: name,
    safetyBackup: safety.name,
    requiresRestart: true
  };
}

export function getPendingRestore() {
  if (!fs.existsSync(pendingRestorePath)) return null;

  try {
    const marker = JSON.parse(fs.readFileSync(pendingMarkerPath, 'utf8'));
    return { ...marker, pendingFile: path.basename(pendingRestorePath) };
  } catch {
    return { pendingFile: path.basename(pendingRestorePath) };
  }
}

export function startBackupScheduler() {
  if (scheduler) return scheduler;

  const run = async () => {
    try {
      const autoBackups = listBackups().filter((backup) => backup.type === 'auto');
      const todayStamp = stamp().slice(0, 8);
      const hasToday = autoBackups.some((backup) => backup.name.includes(todayStamp));
      const hour = new Date().getHours();

      if (autoBackups.length === 0 || (!hasToday && hour >= AUTO_BACKUP_HOUR)) {
        const backup = await createBackup({ type: 'auto' });
        console.log(`Automatic backup created: ${backup.name}`);
      }

      pruneAutoBackups();
    } catch (error) {
      console.error('Automatic backup failed:', error);
    }
  };

  run();
  scheduler = setInterval(run, 60 * 60 * 1000);
  if (scheduler.unref) scheduler.unref();

  return scheduler;
}

export const backupDirectory = backupDir;
