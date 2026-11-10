/**
 * Shop settings schema.
 *
 * A single row (id = 1) holds the details printed on invoices, PDFs and
 * supplier statements. Keeping it in the database means the values survive
 * restarts and browser cache clears, and every terminal sees the same shop
 * information.
 */
import db from '../db/billPayment.js';

db.exec(`
CREATE TABLE IF NOT EXISTS shop_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  shopName TEXT NOT NULL DEFAULT '',
  drugLicenceNumber TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  gstin TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  pharmacistName TEXT NOT NULL DEFAULT '',
  invoiceFooter TEXT NOT NULL DEFAULT '',
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// Seed the row with the details the app used before settings existed, so the
// first invoice after the upgrade looks exactly the same.
db.prepare(`
  INSERT INTO shop_settings (
    id, shopName, drugLicenceNumber, phone, address, gstin, email,
    pharmacistName, invoiceFooter
  )
  SELECT 1, ?, ?, ?, ?, '', '', '', ?
  WHERE NOT EXISTS (SELECT 1 FROM shop_settings WHERE id = 1)
`).run(
  'SAABIT PHARMACY',
  '13351/52',
  '+91 9797027047',
  'Kak Sarai, Karan Nagar, Opp HDFC Bank, Srinagar',
  'Thank you for choosing Saabit Pharmacy. Get well soon!'
);
