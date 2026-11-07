/**
 * Read model for supplier ledger screens.
 *
 * The source tables remain the source of truth. This view gives every
 * transaction a stable composite sort key and a signed amount so summary and
 * cursor-pagination queries share the same logic.
 */
import db from '../db/billPayment.js';

db.exec(`
CREATE INDEX IF NOT EXISTS idx_purchase_bills_supplier_date
  ON purchase_bills(supplierName, date);

CREATE INDEX IF NOT EXISTS idx_credit_notes_supplier_date
  ON credit_notes(supplierName, date);

DROP VIEW IF EXISTS supplier_transactions;

CREATE VIEW supplier_transactions AS
SELECT
  'bill' AS source,
  1 AS sourceRank,
  id,
  date,
  invoice,
  supplierName,
  COALESCE(total, 0) AS total,
  COALESCE(total, 0) AS signedAmount,
  COALESCE(type, 'Bill') AS type
FROM purchase_bills
WHERE status <> 'void'

UNION ALL

SELECT
  'payment' AS source,
  2 AS sourceRank,
  id,
  date,
  invoice,
  supplierName,
  COALESCE(total, 0) AS total,
  -COALESCE(total, 0) AS signedAmount,
  'Payment' AS type
FROM payments

UNION ALL

SELECT
  'credit_note' AS source,
  3 AS sourceRank,
  id,
  date,
  creditNoteNumber AS invoice,
  supplierName,
  COALESCE(total, 0) AS total,
  -COALESCE(total, 0) AS signedAmount,
  'Credit Note' AS type
FROM credit_notes;
`);
