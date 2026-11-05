/**
 * One-time, idempotent migration from the coupled bills/bill_products schema
 * to the decoupled products / inventory_items / purchase_* / invoice_* schema.
 *
 * Usage (from shopbackend):
 *   node scripts/migrateInventorySplit.js
 *
 * Optional test overrides:
 *   DB_PATH=/tmp/test.db INVOICES_DIR=/tmp/invoices node scripts/migrateInventorySplit.js
 *
 * Legacy tables are left untouched as a rollback archive.
 */
import fs from 'fs';
import path from 'path';

import '../src/setup/createInventorySchema.js';
import db from '../src/db/billPayment.js';
import {
  cleanDisplay,
  normalizeKey,
  resolveInventoryItem,
  resolveProduct,
  round2
} from '../src/services/inventoryService.js';

const MIGRATION_KEY = 'inventory_split_v1';
const root = process.cwd();
const invoicesDir = process.env.INVOICES_DIR || path.join(root, 'invoices');
const backupDir = path.join(root, 'backups');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');

const report = {
  startedAt: new Date().toISOString(),
  products: { created: 0 },
  inventory: { rows: 0, quantity: 0, conflicts: [] },
  purchaseBills: { rows: 0 },
  purchaseItems: { rows: 0, unmatchedInventory: 0 },
  invoices: { files: 0, rows: 0, items: 0, skipped: [], unmatchedProducts: [] },
  reconciliation: {}
};

db.exec(`
  CREATE TABLE IF NOT EXISTS migration_state (
    key TEXT PRIMARY KEY,
    completedAt TEXT NOT NULL DEFAULT (datetime('now')),
    details TEXT
  );
`);

const existingState = db.prepare('SELECT * FROM migration_state WHERE key = ?').get(MIGRATION_KEY);
if (existingState) {
  console.log(`Migration "${MIGRATION_KEY}" already completed at ${existingState.completedAt}.`);
  console.log('Nothing to do. Legacy tables were left in place.');
  process.exit(0);
}

function hasTable(name) {
  return Boolean(db.prepare(`
    SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?
  `).get(name));
}

function safeDate(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function numberOr(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const legacyRows = hasTable('bill_products')
  ? db.prepare('SELECT * FROM bill_products ORDER BY id ASC').all()
  : [];

const legacyBills = hasTable('bills')
  ? db.prepare('SELECT * FROM bills ORDER BY id ASC').all()
  : [];

const rawInvoices = [];
if (fs.existsSync(invoicesDir)) {
  const files = fs.readdirSync(invoicesDir)
    .filter((file) => file.endsWith('.json'))
    .sort();

  report.invoices.files = files.length;

  for (const file of files) {
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(invoicesDir, file), 'utf8'));
      if (Array.isArray(parsed)) {
        for (const invoice of parsed) rawInvoices.push({ file, invoice });
      }
    } catch (error) {
      report.invoices.skipped.push({ file, reason: `Could not parse: ${error.message}` });
    }
  }
}

const statements = {
  insertPurchaseBill: db.prepare(`
    INSERT OR IGNORE INTO purchase_bills (
      id, invoice, date, supplierName, supplierDrugLn, supplierContact,
      totalAmount, totalGst, totalDiscount, total, type, status, createdAt, updatedAt
    ) VALUES (
      @id, @invoice, @date, @supplierName, @supplierDrugLn, @supplierContact,
      @totalAmount, @totalGst, @totalDiscount, @total, @type, 'posted',
      @createdAt, @updatedAt
    )
  `),
  insertPurchaseItem: db.prepare(`
    INSERT OR IGNORE INTO purchase_items (
      id, purchaseBillId, productId, inventoryItemId, nameSnapshot,
      batchNumberSnapshot, expiryDateSnapshot, quantity, unitPrice, mrp,
      discount, gstPercentage, supplierSnapshot, categorySnapshot, createdAt
    ) VALUES (
      @id, @purchaseBillId, @productId, @inventoryItemId, @nameSnapshot,
      @batchNumberSnapshot, @expiryDateSnapshot, @quantity, @unitPrice, @mrp,
      @discount, @gstPercentage, @supplierSnapshot, @categorySnapshot, @createdAt
    )
  `),
  updateInventoryQuantity: db.prepare(`
    UPDATE inventory_items SET quantity = @quantity, updatedAt = datetime('now') WHERE id = @id
  `),
  insertOpeningMovement: db.prepare(`
    INSERT INTO stock_movements (
      inventoryItemId, productId, type, quantityDelta, quantityBefore,
      quantityAfter, referenceType, referenceId, note
    ) VALUES (
      @inventoryItemId, @productId, 'opening_balance', @quantity, 0,
      @quantity, 'migration', NULL, 'Opening balance from legacy bill_products'
    )
  `),
  hasOpeningMovement: db.prepare(`
    SELECT 1 FROM stock_movements
    WHERE inventoryItemId = ? AND type = 'opening_balance'
    LIMIT 1
  `),
  productByNormalized: db.prepare('SELECT * FROM products WHERE normalizedName = ?'),
  inventoryByProductBatch: db.prepare(`
    SELECT * FROM inventory_items WHERE productId = ? AND batchKey = ?
  `),
  insertInvoice: db.prepare(`
    INSERT INTO invoices (
      invoiceNumber, customerName, customerPhone, customerAddress, subtotal,
      totalDiscount, totalGst, total, status, stockDeducted, legacyRecord,
      prescriptionJson, idempotencyKey, createdAt
    ) VALUES (
      @invoiceNumber, @customerName, @customerPhone, @customerAddress, @subtotal,
      @totalDiscount, @totalGst, @total, @status, 0, 1,
      @prescriptionJson, NULL, @createdAt
    )
  `),
  invoiceByNumber: db.prepare('SELECT id FROM invoices WHERE invoiceNumber = ?'),
  insertInvoiceItem: db.prepare(`
    INSERT INTO invoice_items (
      invoiceId, productId, inventoryItemId, nameSnapshot, batchNumberSnapshot,
      expiryDateSnapshot, saltSummarySnapshot, quantity, unitPrice, mrpSnapshot,
      discountPercent, discountAmount, gstPercent, gstAmount, lineSubtotal,
      lineTotal, createdAt
    ) VALUES (
      @invoiceId, @productId, @inventoryItemId, @nameSnapshot, @batchNumberSnapshot,
      @expiryDateSnapshot, NULL, @quantity, @unitPrice, @mrpSnapshot,
      @discountPercent, @discountAmount, @gstPercent, @gstAmount, @lineSubtotal,
      @lineTotal, @createdAt
    )
  `)
};

const inventoryGroups = new Map();
const inventoryByProductBatch = new Map();
const legacyProductLinks = new Map();

const migration = db.transaction(() => {
  // ── Products + live inventory batches ────────────────────────────────
  for (const row of legacyRows) {
    const product = resolveProduct({
      name: row.name,
      category: row.category,
      unitPrice: row.unitPrice,
      mrp: row.mrp,
      discount: row.discount,
      gstPercentage: row.gstPercentage
    });

    const inventory = resolveInventoryItem(product.id, {
      batchNumber: row.batchNumber,
      expiryDate: row.expiryDate,
      unitPrice: row.unitPrice,
      mrp: row.mrp,
      sellingPrice: row.mrp,
      discount: row.discount,
      gstPercentage: row.gstPercentage,
      supplier: row.supplier,
      receivedAt: null
    });

    legacyProductLinks.set(Number(row.id), {
      productId: product.id,
      inventoryItemId: inventory.id
    });

    const groupKey = `${product.id}\u0000${inventory.batchKey}`;
    inventoryByProductBatch.set(groupKey, inventory.id);

    if (!inventoryGroups.has(inventory.id)) {
      inventoryGroups.set(inventory.id, {
        inventoryItemId: inventory.id,
        productId: product.id,
        name: product.name,
        batchNumber: row.batchNumber || '',
        quantity: 0,
        rowCount: 0,
        expiryValues: new Set(),
        mrpValues: new Set(),
        unitPriceValues: new Set(),
        nameValues: new Set()
      });
    }

    const group = inventoryGroups.get(inventory.id);
    group.quantity = round2(group.quantity + numberOr(row.stock));
    group.rowCount += 1;
    if (cleanDisplay(row.expiryDate)) group.expiryValues.add(cleanDisplay(row.expiryDate));
    if (row.mrp !== null && row.mrp !== undefined) group.mrpValues.add(numberOr(row.mrp));
    if (row.unitPrice !== null && row.unitPrice !== undefined) group.unitPriceValues.add(numberOr(row.unitPrice));
    if (cleanDisplay(row.name)) group.nameValues.add(cleanDisplay(row.name));
  }

  for (const group of inventoryGroups.values()) {
    statements.updateInventoryQuantity.run({
      id: group.inventoryItemId,
      quantity: group.quantity
    });

    if (!statements.hasOpeningMovement.get(group.inventoryItemId)) {
      statements.insertOpeningMovement.run({
        inventoryItemId: group.inventoryItemId,
        productId: group.productId,
        quantity: group.quantity
      });
    }

    report.inventory.rows += 1;
    report.inventory.quantity = round2(report.inventory.quantity + group.quantity);

    if (report.inventory.conflicts.length < 200) {
      if (group.expiryValues.size > 1) {
        report.inventory.conflicts.push({
          type: 'expiry',
          name: group.name,
          batchNumber: group.batchNumber,
          values: [...group.expiryValues]
        });
      }
      if (group.mrpValues.size > 1) {
        report.inventory.conflicts.push({
          type: 'mrp',
          name: group.name,
          batchNumber: group.batchNumber,
          values: [...group.mrpValues]
        });
      }
      if (group.unitPriceValues.size > 1) {
        report.inventory.conflicts.push({
          type: 'unitPrice',
          name: group.name,
          batchNumber: group.batchNumber,
          values: [...group.unitPriceValues]
        });
      }
      if (group.nameValues.size > 1) {
        report.inventory.conflicts.push({
          type: 'name',
          batchNumber: group.batchNumber,
          values: [...group.nameValues]
        });
      }
    }
  }

  report.products.created = db.prepare('SELECT COUNT(*) AS count FROM products').get().count;

  // ── Purchase bills and immutable purchase-line snapshots ─────────────
  const billById = new Map(legacyBills.map((bill) => [Number(bill.id), bill]));

  for (const bill of legacyBills) {
    const createdAt = safeDate(bill.date) ?? new Date().toISOString();

    statements.insertPurchaseBill.run({
      id: Number(bill.id),
      invoice: cleanDisplay(bill.invoice) || `LEGACY-${bill.id}`,
      date: cleanDisplay(bill.date) || createdAt.slice(0, 10),
      supplierName: cleanDisplay(bill.supplierName) || null,
      supplierDrugLn: cleanDisplay(bill.supplierDrugLn) || null,
      supplierContact: cleanDisplay(bill.supplierContact) || null,
      totalAmount: numberOr(bill.totalAmount),
      totalGst: numberOr(bill.totalGst),
      totalDiscount: numberOr(bill.totalDiscount),
      total: numberOr(bill.total),
      type: cleanDisplay(bill.type) || 'Bill',
      createdAt,
      updatedAt: createdAt
    });

    report.purchaseBills.rows += 1;
  }

  for (const row of legacyRows) {
    const link = legacyProductLinks.get(Number(row.id));
    const bill = billById.get(Number(row.billId));

    if (!link?.inventoryItemId) {
      report.purchaseItems.unmatchedInventory += 1;
    }

    statements.insertPurchaseItem.run({
      id: Number(row.id),
      purchaseBillId: Number(row.billId),
      productId: link?.productId ?? null,
      inventoryItemId: link?.inventoryItemId ?? null,
      nameSnapshot: cleanDisplay(row.name) || 'Unknown medicine',
      batchNumberSnapshot: cleanDisplay(row.batchNumber) || null,
      expiryDateSnapshot: cleanDisplay(row.expiryDate) || null,
      quantity: numberOr(row.stock),
      unitPrice: numberOr(row.unitPrice),
      mrp: numberOr(row.mrp),
      discount: numberOr(row.discount),
      gstPercentage: numberOr(row.gstPercentage),
      supplierSnapshot: cleanDisplay(row.supplier || bill?.supplierName) || null,
      categorySnapshot: cleanDisplay(row.category) || null,
      createdAt: safeDate(bill?.date) ?? new Date().toISOString()
    });

    report.purchaseItems.rows += 1;
  }

  // ── Legacy JSON sales invoices ───────────────────────────────────────
  for (const { file, invoice } of rawInvoices) {
    const invoiceNumber = cleanDisplay(invoice.invoiceNumber);

    if (!invoiceNumber) {
      report.invoices.skipped.push({ file, reason: 'Missing invoice number' });
      continue;
    }

    if (statements.invoiceByNumber.get(invoiceNumber)) {
      report.invoices.skipped.push({ file, invoiceNumber, reason: 'Duplicate invoice number' });
      continue;
    }

    const sourceItems = Array.isArray(invoice.medicines)
      ? invoice.medicines
      : Array.isArray(invoice.items)
        ? invoice.items
        : [];

    const normalizedItems = [];

    for (const item of sourceItems) {
      const name = cleanDisplay(item.name);
      const quantity = numberOr(item.qty ?? item.quantity);

      if (!name || quantity <= 0) {
        report.invoices.skipped.push({
          file,
          invoiceNumber,
          reason: `Skipped invalid line ${name || '(no name)'}`
        });
        continue;
      }

      const product = statements.productByNormalized.get(normalizeKey(name));
      const batchNumber = cleanDisplay(item.batchNumber);
      const batchKey = normalizeKey(batchNumber);
      const inventoryId = product
        ? inventoryByProductBatch.get(`${product.id}\u0000${batchKey}`) ?? null
        : null;

      if (!product) {
        if (report.invoices.unmatchedProducts.length < 200) {
          report.invoices.unmatchedProducts.push({ invoiceNumber, name });
        }
      }

      const unitPrice = numberOr(item.price ?? item.unitPrice ?? item.mrp);
      const mrp = numberOr(item.mrp ?? item.MRP ?? unitPrice);
      const discountPercent = numberOr(item.discount ?? item.discountPercent);
      const gstPercent = numberOr(item.gstPercent ?? item.gstPercentage ?? item.gst);
      const lineSubtotal = round2(unitPrice * quantity);
      const discountAmount = item.discountAmount !== undefined
        ? round2(numberOr(item.discountAmount))
        : round2(lineSubtotal * (discountPercent / 100));
      const gstAmount = item.gstAmount !== undefined
        ? round2(numberOr(item.gstAmount))
        : round2((lineSubtotal - discountAmount) * (gstPercent / 100));
      const lineTotal = item.lineTotal !== undefined
        ? round2(numberOr(item.lineTotal))
        : round2(lineSubtotal - discountAmount + gstAmount);

      normalizedItems.push({
        productId: product?.id ?? null,
        inventoryItemId: inventoryId,
        nameSnapshot: name,
        batchNumberSnapshot: batchNumber || null,
        expiryDateSnapshot: cleanDisplay(item.expiryDate) || null,
        quantity,
        unitPrice,
        mrpSnapshot: mrp,
        discountPercent,
        discountAmount,
        gstPercent,
        gstAmount,
        lineSubtotal,
        lineTotal
      });
    }

    const subtotal = invoice.subtotal !== undefined
      ? round2(numberOr(invoice.subtotal))
      : round2(normalizedItems.reduce((sum, item) => sum + item.lineSubtotal, 0));
    const totalDiscount = invoice.totalDiscount !== undefined
      ? round2(numberOr(invoice.totalDiscount))
      : round2(normalizedItems.reduce((sum, item) => sum + item.discountAmount, 0));
    const totalGst = invoice.totalGst !== undefined
      ? round2(numberOr(invoice.totalGst))
      : round2(normalizedItems.reduce((sum, item) => sum + item.gstAmount, 0));
    const total = invoice.total !== undefined
      ? round2(numberOr(invoice.total))
      : round2(subtotal - totalDiscount + totalGst);

    const createdAt = safeDate(invoice.date) ?? new Date().toISOString();
    const prescription = invoice.prescription
      ? JSON.stringify(invoice.prescription)
      : null;

    const result = statements.insertInvoice.run({
      invoiceNumber,
      customerName: cleanDisplay(invoice.customer?.name) || 'Walk-in Customer',
      customerPhone: cleanDisplay(invoice.customer?.phone) || null,
      customerAddress: cleanDisplay(invoice.customer?.address) || null,
      subtotal,
      totalDiscount,
      totalGst,
      total,
      status: cleanDisplay(invoice.status).toLowerCase() === 'pending' ? 'pending' : 'completed',
      prescriptionJson: prescription,
      createdAt
    });

    const invoiceId = Number(result.lastInsertRowid);

    for (const item of normalizedItems) {
      statements.insertInvoiceItem.run({
        invoiceId,
        ...item,
        createdAt
      });
      report.invoices.items += 1;
    }

    report.invoices.rows += 1;
  }

  // ── Reconciliation ───────────────────────────────────────────────────
  const legacyStock = round2(legacyRows.reduce((sum, row) => sum + numberOr(row.stock), 0));
  const newStock = round2(db.prepare('SELECT COALESCE(SUM(quantity), 0) AS total FROM inventory_items').get().total);
  const legacyBillCount = Number(db.prepare('SELECT COUNT(*) AS count FROM bills').get()?.count ?? 0);
  const migratedBillCount = Number(db.prepare("SELECT COUNT(*) AS count FROM purchase_bills WHERE status <> 'void'").get().count);
  const legacyItemCount = Number(db.prepare('SELECT COUNT(*) AS count FROM bill_products').get()?.count ?? 0);
  const migratedItemCount = Number(db.prepare('SELECT COUNT(*) AS count FROM purchase_items').get().count);

  report.reconciliation = {
    legacyStock,
    newStock,
    stockMatches: Math.abs(legacyStock - newStock) < 0.01,
    legacyBillCount,
    migratedBillCount,
    billsMatch: legacyBillCount === migratedBillCount,
    legacyItemCount,
    migratedItemCount,
    itemsMatch: legacyItemCount === migratedItemCount,
    productCount: Number(db.prepare('SELECT COUNT(*) AS count FROM products').get().count),
    inventoryCount: Number(db.prepare('SELECT COUNT(*) AS count FROM inventory_items').get().count),
    invoiceCount: Number(db.prepare('SELECT COUNT(*) AS count FROM invoices').get().count),
    invoiceItemCount: Number(db.prepare('SELECT COUNT(*) AS count FROM invoice_items').get().count)
  };

  report.finishedAt = new Date().toISOString();

  db.prepare(`
    INSERT INTO migration_state (key, completedAt, details) VALUES (?, datetime('now'), ?)
  `).run(MIGRATION_KEY, JSON.stringify(report.reconciliation));
});

migration.immediate();

mkdirSafe(backupDir);
const reportPath = path.join(backupDir, `migration-report-${stamp}.json`);
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

function mkdirSafe(directory) {
  if (!fs.existsSync(directory)) fs.mkdirSync(directory, { recursive: true });
}

console.log('Migration completed.');
console.log(JSON.stringify(report.reconciliation, null, 2));
console.log(`Report written to ${reportPath}`);
