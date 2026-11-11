/**
 * Apply a prepared database restore on backend startup.
 *
 * This module must be imported before anything that opens the shared database
 * connection. The restore API copies the selected backup to a pending file and
 * asks the operator to restart the backend; this module swaps the files before
 * the first connection is opened.
 */
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

const databasePath = path.resolve(process.env.DB_PATH || 'billsNpayment.db');
const pendingRestorePath = `${databasePath}.pending-restore`;
const pendingMarkerPath = `${pendingRestorePath}.json`;
const backupDir = path.resolve('backups');

const pad = (value) => String(value).padStart(2, '0');

function stamp(date = new Date()) {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

if (fs.existsSync(pendingRestorePath)) {
  try {
    fs.mkdirSync(backupDir, { recursive: true });

    const safetyPath = path.join(backupDir, `pre-restore-${stamp()}.db`);

    if (fs.existsSync(databasePath)) {
      const source = new Database(databasePath, { readonly: true });
      await source.backup(safetyPath);
      source.close();
    }

    for (const suffix of ['-wal', '-shm']) {
      try {
        fs.unlinkSync(`${databasePath}${suffix}`);
      } catch {
        // WAL files may not exist.
      }
    }

    fs.copyFileSync(pendingRestorePath, databasePath);
    fs.unlinkSync(pendingRestorePath);

    if (fs.existsSync(pendingMarkerPath)) {
      fs.unlinkSync(pendingMarkerPath);
    }

    console.log(`Applied pending database restore. Safety backup: ${path.basename(safetyPath)}`);
  } catch (error) {
    console.error('Could not apply pending database restore:', error);
    // Keep the pending file so the operator can retry after fixing the issue.
  }
}
