/**
 * Expiry register schema.
 *
 * A record groups the medicines removed for one distributor. Each line stores
 * the batch number, expiry date, quantity and MRP so the register can replace
 * the physical expiry books.
 */
import db from '../db/billPayment.js';

db.exec(`
CREATE TABLE IF NOT EXISTS expiry_records (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  supplierName TEXT NOT NULL,
  supplierDrugLn TEXT,
  supplierContact TEXT,
  type TEXT NOT NULL DEFAULT 'EXPIRY',
  totalQuantity REAL NOT NULL DEFAULT 0,
  totalMrp REAL NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS expiry_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  expiryRecordId INTEGER NOT NULL REFERENCES expiry_records(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  batchNumber TEXT NOT NULL,
  expiryDate TEXT NOT NULL,
  quantity REAL NOT NULL CHECK (quantity > 0),
  mrp REAL NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_expiry_records_supplier ON expiry_records(supplierName);
CREATE INDEX IF NOT EXISTS idx_expiry_records_date ON expiry_records(date);
CREATE INDEX IF NOT EXISTS idx_expiry_items_record ON expiry_items(expiryRecordId);
CREATE INDEX IF NOT EXISTS idx_expiry_items_expiry ON expiry_items(expiryDate);
`);
