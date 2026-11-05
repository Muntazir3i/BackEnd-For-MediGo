/**
 * Keep only the N most recently purchased inventory batches per product.
 *
 * "Most recent" is the highest purchase-bill id attached to the batch, then
 * the inventory row's createdAt/id as tie-breakers. This matches the order in
 * which batches were actually received, rather than the migration timestamp.
 *
 * Default mode archives older batches (isActive = 0). This removes them from
 * inventory, billing and search while keeping every purchase_items,
 * invoice_items and stock_movements reference valid.
 *
 * Usage (from shopbackend):
 *   node scripts/dedupeInventory.js --dry-run
 *   node scripts/dedupeInventory.js --keep=3
 *   node scripts/dedupeInventory.js --keep=3 --hard   # physically removes rows
 *
 * --hard first re-points historical references to NULL, archives the stock
 * movements, then deletes the inventory rows. It is irreversible.
 */
import fs from 'fs';
import path from 'path';

import db from '../src/db/billPayment.js';
import { round2 } from '../src/services/inventoryService.js';

const args = process.argv.slice(2);
const hasFlag = (flag) => args.includes(flag);
const getOption = (name, fallback) => {
  const prefix = `--${name}=`;
  const match = args.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
};

const KEEP = Number(getOption('keep', 3));
const DRY_RUN = hasFlag('--dry-run');
const HARD_DELETE = hasFlag('--hard');
const NO_BACKUP = hasFlag('--no-backup');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');

if (!Number.isSafeInteger(KEEP) || KEEP < 1) {
  console.error('--keep must be a whole number of at least 1');
  process.exit(1);
}

const backupDir = path.join(process.cwd(), 'backups');
if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

db.pragma('busy_timeout = 10000');

db.exec(`
  CREATE TABLE IF NOT EXISTS dedup_runs (
    id INTEGER PRIMARY KEY,
    task TEXT NOT NULL,
    criteriaJson TEXT,
    backupPath TEXT,
    summaryJson TEXT,
    startedAt TEXT NOT NULL DEFAULT (datetime('now')),
    finishedAt TEXT
  );

  CREATE TABLE IF NOT EXISTS dedup_actions (
    id INTEGER PRIMARY KEY,
    runId INTEGER NOT NULL REFERENCES dedup_runs(id) ON DELETE CASCADE,
    entity TEXT NOT NULL,
    entityId INTEGER NOT NULL,
    action TEXT NOT NULL,
    survivorId INTEGER,
    payloadJson TEXT,
    createdAt TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

if (HARD_DELETE) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS stock_movements_archive (
      id INTEGER,
      inventoryItemId INTEGER,
      productId INTEGER,
      type TEXT,
      quantityDelta REAL,
      quantityBefore REAL,
      quantityAfter REAL,
      referenceType TEXT,
      referenceId INTEGER,
      note TEXT,
      createdAt TEXT,
      archivedAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

const rows = db.prepare(`
  SELECT
    i.id,
    i.productId,
    p.name,
    i.batchNumber,
    i.expiryDate,
    i.quantity,
    i.createdAt,
    (
      SELECT MAX(pi.purchaseBillId)
      FROM purchase_items pi
      WHERE pi.inventoryItemId = i.id
    ) AS lastBillId
  FROM inventory_items i
  JOIN products p ON p.id = i.productId
  WHERE i.isActive = 1
  ORDER BY i.productId ASC, i.createdAt DESC, i.id DESC
`).all();

const recency = (row) => [
  Number(row.lastBillId) || 0,
  String(row.createdAt || ''),
  Number(row.id) || 0
];

const byProduct = new Map();

for (const row of rows) {
  if (!byProduct.has(row.productId)) {
    byProduct.set(row.productId, {
      productId: row.productId,
      name: row.name,
      rows: []
    });
  }
  byProduct.get(row.productId).rows.push(row);
}

const groups = [];
const losers = [];

for (const group of byProduct.values()) {
  const sorted = [...group.rows].sort((a, b) => {
    const [aBill, aCreated, aId] = recency(a);
    const [bBill, bCreated, bId] = recency(b);
    if (aBill !== bBill) return bBill - aBill;
    if (aCreated !== bCreated) return bCreated.localeCompare(aCreated);
    return bId - aId;
  });

  const kept = sorted.slice(0, KEEP);
  const removed = sorted.slice(KEEP);

  if (removed.length === 0) continue;

  groups.push({
    productId: group.productId,
    name: group.name,
    before: sorted.length,
    kept: kept.length,
    removed: removed.length,
    keptRows: kept.map((row) => ({
      id: row.id,
      batchNumber: row.batchNumber,
      expiryDate: row.expiryDate,
      quantity: row.quantity,
      lastBillId: row.lastBillId
    })),
    removedRows: removed.map((row) => ({
      id: row.id,
      batchNumber: row.batchNumber,
      expiryDate: row.expiryDate,
      quantity: row.quantity,
      lastBillId: row.lastBillId
    }))
  });

  for (const row of removed) {
    losers.push({ ...row, groupName: group.name });
  }
}

const before = {
  activeRows: rows.length,
  activeQuantity: round2(rows.reduce((sum, row) => sum + Number(row.quantity || 0), 0))
};

const removedQuantity = round2(
  losers.reduce((sum, row) => sum + Number(row.quantity || 0), 0)
);

console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : HARD_DELETE ? 'HARD DELETE' : 'ARCHIVE'}`);
console.log(`Keep per product: ${KEEP}`);
console.log(`Products affected: ${groups.length}`);
console.log(`Rows to remove: ${losers.length}`);
console.log(`Quantity to remove: ${removedQuantity}`);
console.log(`Quantity kept: ${round2(before.activeQuantity - removedQuantity)}`);
console.log(`Rows kept: ${rows.length - losers.length}`);

const sampleNames = ['PANTOP DSR', 'PANTOCID DSR'];
const samples = groups.filter((group) => sampleNames.includes(group.name));
for (const sample of samples) {
  console.log(`\n${sample.name}: ${sample.before} batches -> keeping ${sample.kept}`);
  console.log('  keep:', sample.keptRows);
  console.log('  remove:', sample.removedRows.map((row) => ({
    id: row.id,
    batchNumber: row.batchNumber,
    quantity: row.quantity,
    expiryDate: row.expiryDate
  })));
}

let backupPath = null;

if (!DRY_RUN && !NO_BACKUP) {
  backupPath = path.join(backupDir, `billsNpayment-pre-dedupe-${stamp}.db`);
  await db.backup(backupPath);
  console.log(`\nBackup written to ${backupPath}`);
}

const report = {
  startedAt: new Date().toISOString(),
  mode: DRY_RUN ? 'dry-run' : HARD_DELETE ? 'hard-delete' : 'archive',
  keep: KEEP,
  backupPath,
  before,
  after: {},
  removed: { rows: losers.length, quantity: removedQuantity },
  groups
};

if (!DRY_RUN && losers.length > 0) {
  const apply = db.transaction(() => {
    const runResult = db.prepare(`
      INSERT INTO dedup_runs (task, criteriaJson, backupPath)
      VALUES (?, ?, ?)
    `).run(
      'keep_latest_inventory_batches',
      JSON.stringify({ keep: KEEP, mode: HARD_DELETE ? 'hard-delete' : 'archive' }),
      backupPath
    );

    const runId = Number(runResult.lastInsertRowid);

    const archiveItem = db.prepare(`
      UPDATE inventory_items
      SET isActive = 0, updatedAt = datetime('now')
      WHERE id = ?
    `);

    const archiveMovements = HARD_DELETE
      ? db.prepare(`
        INSERT INTO stock_movements_archive (
          id, inventoryItemId, productId, type, quantityDelta, quantityBefore,
          quantityAfter, referenceType, referenceId, note, createdAt
        )
        SELECT
          id, inventoryItemId, productId, type, quantityDelta, quantityBefore,
          quantityAfter, referenceType, referenceId, note, createdAt
        FROM stock_movements
        WHERE inventoryItemId = ?
      `)
      : null;

    const deleteMovements = HARD_DELETE
      ? db.prepare('DELETE FROM stock_movements WHERE inventoryItemId = ?')
      : null;

    const detachPurchaseItems = db.prepare(`
      UPDATE purchase_items SET inventoryItemId = NULL WHERE inventoryItemId = ?
    `);

    const detachInvoiceItems = db.prepare(`
      UPDATE invoice_items SET inventoryItemId = NULL WHERE inventoryItemId = ?
    `);

    const deleteItem = db.prepare('DELETE FROM inventory_items WHERE id = ?');

    const writeAction = db.prepare(`
      INSERT INTO dedup_actions (runId, entity, entityId, action, survivorId, payloadJson)
      VALUES (@runId, 'inventory_item', @entityId, @action, @survivorId, @payloadJson)
    `);

    for (const winner of groups) {
      const survivorId = winner.keptRows[0]?.id ?? null;

      for (const row of winner.removedRows) {
        const payload = JSON.stringify({
          productId: winner.productId,
          name: winner.name,
          batchNumber: row.batchNumber,
          expiryDate: row.expiryDate,
          quantity: row.quantity,
          lastBillId: row.lastBillId,
          reason: `keep_latest_${KEEP}`
        });

        if (HARD_DELETE) {
          archiveMovements.run(row.id);
          deleteMovements.run(row.id);
          detachPurchaseItems.run(row.id);
          detachInvoiceItems.run(row.id);
          deleteItem.run(row.id);

          writeAction.run({
            runId,
            entityId: row.id,
            action: 'delete',
            survivorId,
            payloadJson: payload
          });
        } else {
          archiveItem.run(row.id);

          writeAction.run({
            runId,
            entityId: row.id,
            action: 'archive',
            survivorId,
            payloadJson: payload
          });
        }
      }
    }

    const summary = JSON.stringify({
      productsAffected: groups.length,
      rowsRemoved: losers.length,
      quantityRemoved: removedQuantity
    });

    db.prepare(`
      UPDATE dedup_runs SET summaryJson = ?, finishedAt = datetime('now') WHERE id = ?
    `).run(summary, runId);

    return runId;
  });

  const runId = apply();
  report.runId = runId;
}

const after = {
  activeRows: Number(db.prepare(
    'SELECT COUNT(*) AS c FROM inventory_items WHERE isActive = 1'
  ).get().c),
  activeQuantity: round2(db.prepare(
    'SELECT COALESCE(SUM(quantity), 0) AS q FROM inventory_items WHERE isActive = 1'
  ).get().q),
  totalRows: Number(db.prepare(
    'SELECT COUNT(*) AS c FROM inventory_items'
  ).get().c)
};

report.after = after;
report.finishedAt = new Date().toISOString();

const integrity = db.prepare('PRAGMA integrity_check').get().integrity_check;
const fkViolations = db.prepare('PRAGMA foreign_key_check').all();
const invoiceCount = Number(db.prepare('SELECT COUNT(*) AS c FROM invoices').get().c);
const invoiceItemCount = Number(db.prepare('SELECT COUNT(*) AS c FROM invoice_items').get().c);
const purchaseCount = Number(db.prepare('SELECT COUNT(*) AS c FROM purchase_items').get().c);

report.verification = {
  integrity,
  fkViolations: fkViolations.length,
  invoiceCount,
  invoiceItemCount,
  purchaseItemCount: purchaseCount,
  negativeStock: Number(db.prepare(
    'SELECT COUNT(*) AS c FROM inventory_items WHERE quantity < 0'
  ).get().c),
  activeDuplicatesPerProduct: Number(db.prepare(`
    SELECT COUNT(*) AS c FROM (
      SELECT productId FROM inventory_items
      WHERE isActive = 1
      GROUP BY productId
      HAVING COUNT(*) > ?
    )
  `).get(KEEP).c)
};

const reportPath = path.join(backupDir, `dedupe-report-${stamp}.json`);
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

console.log('\nAfter:');
console.log(report.after);
console.log('Verification:');
console.log(report.verification);
console.log(`Report written to ${reportPath}`);

if (DRY_RUN) {
  console.log('\nDry run only - no rows were changed.');
}
