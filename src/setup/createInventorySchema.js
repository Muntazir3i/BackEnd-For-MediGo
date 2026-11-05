/**
 * Inventory / invoice split schema.
 *
 * The legacy tables (`bills`, `bill_products`) are intentionally left in place
 * as a rollback archive. New code reads and writes the tables below.
 */
import db from '../db/billPayment.js';

db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  normalizedName TEXT NOT NULL UNIQUE,
  category TEXT,
  form TEXT,
  manufacturer TEXT,
  defaultPurchasePrice REAL NOT NULL DEFAULT 0,
  defaultMrp REAL NOT NULL DEFAULT 0,
  defaultSellingPrice REAL NOT NULL DEFAULT 0,
  discount REAL NOT NULL DEFAULT 0,
  gstPercentage REAL NOT NULL DEFAULT 0,
  isActive INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS salts (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  normalizedName TEXT NOT NULL UNIQUE,
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS salt_aliases (
  id INTEGER PRIMARY KEY,
  saltId INTEGER NOT NULL REFERENCES salts(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  normalizedAlias TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS product_salts (
  productId INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  saltId INTEGER NOT NULL REFERENCES salts(id) ON DELETE CASCADE,
  strengthValue REAL,
  strengthUnit TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  source TEXT,
  confidence REAL,
  verified INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (productId, saltId)
);

CREATE TABLE IF NOT EXISTS inventory_items (
  id INTEGER PRIMARY KEY,
  productId INTEGER NOT NULL REFERENCES products(id),
  batchNumber TEXT NOT NULL DEFAULT '',
  batchKey TEXT NOT NULL DEFAULT '',
  expiryDate TEXT,
  quantity REAL NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  purchasePrice REAL NOT NULL DEFAULT 0,
  mrp REAL NOT NULL DEFAULT 0,
  sellingPrice REAL NOT NULL DEFAULT 0,
  discount REAL NOT NULL DEFAULT 0,
  gstPercentage REAL NOT NULL DEFAULT 0,
  supplier TEXT,
  supplierId INTEGER,
  receivedAt TEXT,
  isActive INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (productId, batchKey)
);

CREATE TABLE IF NOT EXISTS purchase_bills (
  id INTEGER PRIMARY KEY,
  invoice TEXT NOT NULL,
  date TEXT NOT NULL,
  supplierName TEXT,
  supplierDrugLn TEXT,
  supplierContact TEXT,
  totalAmount REAL NOT NULL DEFAULT 0,
  totalGst REAL NOT NULL DEFAULT 0,
  totalDiscount REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  type TEXT DEFAULT 'Bill',
  status TEXT NOT NULL DEFAULT 'posted',
  createdAt TEXT,
  updatedAt TEXT
);

CREATE TABLE IF NOT EXISTS purchase_items (
  id INTEGER PRIMARY KEY,
  purchaseBillId INTEGER NOT NULL REFERENCES purchase_bills(id) ON DELETE CASCADE,
  productId INTEGER REFERENCES products(id),
  inventoryItemId INTEGER REFERENCES inventory_items(id),
  nameSnapshot TEXT NOT NULL,
  batchNumberSnapshot TEXT,
  expiryDateSnapshot TEXT,
  quantity REAL NOT NULL,
  unitPrice REAL NOT NULL,
  mrp REAL NOT NULL,
  discount REAL NOT NULL DEFAULT 0,
  gstPercentage REAL NOT NULL DEFAULT 0,
  supplierSnapshot TEXT,
  categorySnapshot TEXT,
  createdAt TEXT
);

CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY,
  invoiceNumber TEXT NOT NULL UNIQUE,
  customerName TEXT NOT NULL,
  customerPhone TEXT,
  customerAddress TEXT,
  subtotal REAL NOT NULL DEFAULT 0,
  totalDiscount REAL NOT NULL DEFAULT 0,
  totalGst REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'completed',
  stockDeducted INTEGER NOT NULL DEFAULT 1,
  legacyRecord INTEGER NOT NULL DEFAULT 0,
  prescriptionJson TEXT,
  idempotencyKey TEXT UNIQUE,
  createdAt TEXT NOT NULL,
  voidedAt TEXT
);

CREATE TABLE IF NOT EXISTS invoice_items (
  id INTEGER PRIMARY KEY,
  invoiceId INTEGER NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  productId INTEGER REFERENCES products(id),
  inventoryItemId INTEGER REFERENCES inventory_items(id),
  nameSnapshot TEXT NOT NULL,
  batchNumberSnapshot TEXT,
  expiryDateSnapshot TEXT,
  saltSummarySnapshot TEXT,
  quantity REAL NOT NULL CHECK (quantity > 0),
  unitPrice REAL NOT NULL,
  mrpSnapshot REAL,
  discountPercent REAL NOT NULL DEFAULT 0,
  discountAmount REAL NOT NULL DEFAULT 0,
  gstPercent REAL NOT NULL DEFAULT 0,
  gstAmount REAL NOT NULL DEFAULT 0,
  lineSubtotal REAL NOT NULL,
  lineTotal REAL NOT NULL,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id INTEGER PRIMARY KEY,
  inventoryItemId INTEGER NOT NULL REFERENCES inventory_items(id),
  productId INTEGER NOT NULL REFERENCES products(id),
  type TEXT NOT NULL,
  quantityDelta REAL NOT NULL,
  quantityBefore REAL NOT NULL,
  quantityAfter REAL NOT NULL,
  referenceType TEXT,
  referenceId INTEGER,
  note TEXT,
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_products_name ON products(normalizedName);
CREATE INDEX IF NOT EXISTS idx_products_active ON products(isActive);
CREATE INDEX IF NOT EXISTS idx_product_salts_salt ON product_salts(saltId);
CREATE INDEX IF NOT EXISTS idx_inventory_product ON inventory_items(productId);
CREATE INDEX IF NOT EXISTS idx_inventory_expiry ON inventory_items(expiryDate);
CREATE INDEX IF NOT EXISTS idx_inventory_quantity ON inventory_items(quantity);
CREATE INDEX IF NOT EXISTS idx_purchase_items_bill ON purchase_items(purchaseBillId);
CREATE INDEX IF NOT EXISTS idx_purchase_items_product ON purchase_items(productId);
CREATE INDEX IF NOT EXISTS idx_purchase_items_inventory ON purchase_items(inventoryItemId);
CREATE INDEX IF NOT EXISTS idx_invoices_date ON invoices(createdAt);
CREATE INDEX IF NOT EXISTS idx_invoices_number ON invoices(invoiceNumber);
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items(invoiceId);
CREATE INDEX IF NOT EXISTS idx_invoice_items_product ON invoice_items(productId);
CREATE INDEX IF NOT EXISTS idx_stock_movements_item ON stock_movements(inventoryItemId);
CREATE INDEX IF NOT EXISTS idx_stock_movements_reference ON stock_movements(referenceType, referenceId);
`);

// Archived batches (isActive = 0) must not count towards live stock.
db.exec('DROP VIEW IF EXISTS product_stock');
db.exec(`
CREATE VIEW product_stock AS
SELECT
  p.id AS productId,
  p.name,
  p.isActive,
  COALESCE(SUM(CASE WHEN i.isActive = 1 THEN i.quantity ELSE 0 END), 0) AS stockOnHand,
  COUNT(CASE WHEN i.isActive = 1 AND i.quantity > 0 THEN 1 END) AS batchesInStock
FROM products p
LEFT JOIN inventory_items i ON i.productId = p.id
GROUP BY p.id;
`);
