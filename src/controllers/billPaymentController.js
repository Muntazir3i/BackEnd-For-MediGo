/**
 * Controller for supplier bill/payment transactions.
 *
 * Fetches a supplier's bills and payments in a single SQL query (newest
 * history is sorted in the database), optionally limited to a date range,
 * and calculates the opening/closing balance and running balance.
 */
import db from '../db/billPayment.js';
import supplierDb from '../db/db.js';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// 1. Pre-compile statements for better performance.
const statements = {
  transactions: db.prepare(`
    SELECT id, date, invoice, supplierName, total, COALESCE(type, 'Bill') AS type
    FROM purchase_bills
    WHERE supplierName = @supplierName
      AND status <> 'void'
      AND (@from IS NULL OR date >= @from)
      AND (@toExclusive IS NULL OR date < @toExclusive)
    UNION ALL
    SELECT id, date, invoice, supplierName, total, 'Payment' AS type
    FROM payments
    WHERE supplierName = @supplierName
      AND (@from IS NULL OR date >= @from)
      AND (@toExclusive IS NULL OR date < @toExclusive)
    ORDER BY date ASC, id ASC
  `),
  netBeforeFrom: db.prepare(`
    SELECT
      COALESCE((SELECT SUM(total) FROM purchase_bills WHERE supplierName = @supplierName AND status <> 'void' AND date < @from), 0)
      - COALESCE((SELECT SUM(total) FROM payments WHERE supplierName = @supplierName AND date < @from), 0)
      AS net
  `),
  supplierBalance: supplierDb.prepare(`
    SELECT supplierBalance FROM suppliers WHERE supplierName = ? LIMIT 1
  `)
};

function normalizeDate(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return DATE_PATTERN.test(trimmed) ? trimmed : null;
}

// Exclusive upper bound so transactions with a time component are included.
function nextDay(date) {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString().slice(0, 10);
}

export function getAllRecords(req, res) {
  try {
    const { supplierName, from, to } = req.query;

    if (!supplierName) {
      return res.status(400).json({ error: 'Supplier name is required' });
    }

    const fromDate = normalizeDate(from);
    const toDate = normalizeDate(to);

    if (from && !fromDate) {
      return res.status(400).json({ error: 'Invalid "from" date. Use YYYY-MM-DD.' });
    }

    if (to && !toDate) {
      return res.status(400).json({ error: 'Invalid "to" date. Use YYYY-MM-DD.' });
    }

    if (fromDate && toDate && fromDate > toDate) {
      return res.status(400).json({ error: '"from" date must be before "to" date.' });
    }

    const toExclusive = toDate ? nextDay(toDate) : null;

    const rows = statements.transactions.all({
      supplierName,
      from: fromDate,
      toExclusive
    });

    // The supplier balance is the balance carried into the ledger. When a
    // start date is provided, roll it forward with everything before that date.
    const stored = statements.supplierBalance.get(supplierName);
    let openingBalance = stored
      ? Number(stored.supplierBalance) || 0
      : Number(req.query.openingBalance) || 0;

    if (fromDate) {
      const { net } = statements.netBeforeFrom.get({ supplierName, from: fromDate });
      openingBalance += Number(net) || 0;
    }

    let runningBalance = openingBalance;
    let totalBills = 0;
    let totalPayments = 0;

    const transactions = rows.map((row) => {
      const amount = Number(row.total) || 0;

      if (row.type === 'Bill') {
        runningBalance += amount;
        totalBills += amount;
      } else {
        runningBalance -= amount;
        totalPayments += amount;
      }

      return {
        ...row,
        total: amount,
        balance: runningBalance
      };
    });

    return res.status(200).json({
      transactions,
      summary: {
        supplierName,
        openingBalance,
        totalBills,
        totalPayments,
        closingBalance: runningBalance,
        transactionCount: transactions.length
      }
    });
  } catch (error) {
    console.error('Error fetching supplier transactions:', error.message);
    return res.status(500).json({ error: 'Failed to fetch transactions' });
  }
}
