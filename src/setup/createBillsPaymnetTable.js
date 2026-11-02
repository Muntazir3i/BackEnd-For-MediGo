import db from '../db/billPayment.js'

db.exec(`
CREATE TABLE IF NOT EXISTS bills (
  id INTEGER PRIMARY KEY,
  invoice TEXT,
  date TEXT,
  supplierName TEXT,
  supplierDrugLn TEXT,
  supplierContact TEXT,
  totalAmount REAL,
  totalGst REAL,
  totalDiscount REAL,
  total REAL,
  type TEXT
);

CREATE TABLE IF NOT EXISTS bill_products (
  id INTEGER PRIMARY KEY,
  billId INTEGER,
  name TEXT,
  batchNumber TEXT,
  expiryDate TEXT,
  stock INTEGER,
  unitPrice REAL,
  mrp REAL,
  discount REAL,
  gstPercentage REAL,
  supplier TEXT,
  category TEXT,
  FOREIGN KEY (billId) REFERENCES bills(id)
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY,
  date TEXT,
  invoice TEXT,
  supplierName TEXT,
  drugLicenseNumber TEXT,
  total REAL,
  type TEXT
);
`);

// Indexes used by the paginated bill list and the medicine/batch search.
db.exec(`
CREATE INDEX IF NOT EXISTS idx_bills_supplierName ON bills(supplierName);
CREATE INDEX IF NOT EXISTS idx_bills_type ON bills(type);
CREATE INDEX IF NOT EXISTS idx_bills_date ON bills(date);
CREATE INDEX IF NOT EXISTS idx_bills_supplier_date ON bills(supplierName, date);
CREATE INDEX IF NOT EXISTS idx_bill_products_billId ON bill_products(billId);
CREATE INDEX IF NOT EXISTS idx_bill_products_name ON bill_products(name);
CREATE INDEX IF NOT EXISTS idx_bill_products_batchNumber ON bill_products(batchNumber);
CREATE INDEX IF NOT EXISTS idx_payments_supplierName ON payments(supplierName);
CREATE INDEX IF NOT EXISTS idx_payments_date ON payments(date);
CREATE INDEX IF NOT EXISTS idx_payments_supplier_date ON payments(supplierName, date);
`);

console.log('✅ Tables created (if not already present)');
