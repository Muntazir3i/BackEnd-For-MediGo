/**
 * Credit note register.
 *
 * A credit note is a multi-line document, matching a purchase bill:
 * header details plus medicine lines with quantity, rate, MRP, discount and GST.
 */
import db from '../db/billPayment.js';

const creditNoteColumns = db.prepare('PRAGMA table_info(credit_notes)').all();
const isLegacyFlatTable =
  creditNoteColumns.length > 0 &&
  creditNoteColumns.some((column) => column.name === 'medicineName') &&
  !creditNoteColumns.some((column) => column.name === 'totalAmount');

let legacyRows = [];

if (isLegacyFlatTable) {
  legacyRows = db.prepare('SELECT * FROM credit_notes').all();
  db.exec(`
    DROP INDEX IF EXISTS idx_credit_notes_number;
    DROP INDEX IF EXISTS idx_credit_notes_supplier;
    DROP INDEX IF EXISTS idx_credit_notes_date;
    ALTER TABLE credit_notes RENAME TO credit_notes_legacy;
  `);
}

db.exec(`
CREATE TABLE IF NOT EXISTS credit_notes (
  id INTEGER PRIMARY KEY,
  creditNoteNumber TEXT NOT NULL,
  date TEXT NOT NULL,
  supplierName TEXT NOT NULL,
  supplierDrugLn TEXT,
  supplierContact TEXT,
  totalAmount REAL NOT NULL DEFAULT 0,
  totalDiscount REAL NOT NULL DEFAULT 0,
  totalGst REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS credit_note_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  creditNoteId INTEGER NOT NULL REFERENCES credit_notes(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT,
  batchNumber TEXT,
  expiryDate TEXT,
  quantity REAL NOT NULL CHECK (quantity > 0),
  unitPrice REAL NOT NULL DEFAULT 0,
  mrp REAL NOT NULL DEFAULT 0,
  discount REAL NOT NULL DEFAULT 0,
  gstPercentage REAL NOT NULL DEFAULT 0,
  lineTotal REAL NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_credit_notes_number ON credit_notes(creditNoteNumber);
CREATE INDEX IF NOT EXISTS idx_credit_notes_supplier ON credit_notes(supplierName);
CREATE INDEX IF NOT EXISTS idx_credit_notes_date ON credit_notes(date);
CREATE INDEX IF NOT EXISTS idx_credit_note_items_note ON credit_note_items(creditNoteId);
`);

if (legacyRows.length > 0) {
  const insertHeader = db.prepare(`
    INSERT INTO credit_notes (
      id, creditNoteNumber, date, supplierName, totalAmount, totalDiscount, totalGst, total
    ) VALUES (
      @id, @creditNoteNumber, @date, @supplierName, @totalAmount, 0, 0, @total
    )
  `);
  const insertItem = db.prepare(`
    INSERT INTO credit_note_items (
      creditNoteId, name, batchNumber, quantity, unitPrice, mrp, lineTotal
    ) VALUES (
      @creditNoteId, @name, @batchNumber, @quantity, @unitPrice, @mrp, @lineTotal
    )
  `);

  const migrateLegacy = db.transaction(() => {
    for (const row of legacyRows) {
      insertHeader.run({
        id: row.id,
        creditNoteNumber: row.creditNoteNumber,
        date: row.date,
        supplierName: row.supplierName,
        totalAmount: Number(row.creditAmount) || 0,
        total: Number(row.creditAmount) || 0
      });
      insertItem.run({
        creditNoteId: row.id,
        name: row.medicineName,
        batchNumber: row.batchNumber,
        quantity: Number(row.quantity) || 0,
        unitPrice: Number(row.unitPrice) || 0,
        mrp: Number(row.mrp) || 0,
        lineTotal: Number(row.creditAmount) || 0
      });
    }
  });

  migrateLegacy();
  db.exec('DROP TABLE credit_notes_legacy');
}
