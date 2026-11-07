/**
 * Supplier ledger queries.
 *
 * Source tables remain the source of truth. The supplier_transactions view
 * provides a stable composite order (date, sourceRank, id) for cursor
 * pagination and shared summary calculations.
 */
import db from '../db/billPayment.js';
import supplierDb from '../db/db.js';
import { validationError } from '../utils/httpError.js';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

const statements = {
  summary: db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN type = 'Bill' THEN total ELSE 0 END), 0) AS totalBills,
      COALESCE(SUM(CASE WHEN type = 'Payment' THEN total ELSE 0 END), 0) AS totalPayments,
      COALESCE(SUM(CASE WHEN type = 'Credit Note' THEN total ELSE 0 END), 0) AS totalCreditNotes,
      COALESCE(SUM(signedAmount), 0) AS net,
      COUNT(*) AS transactionCount
    FROM supplier_transactions
    WHERE supplierName = @supplierName
      AND (@from IS NULL OR date >= @from)
      AND (@toExclusive IS NULL OR date < @toExclusive)
  `),
  netBeforeFrom: db.prepare(`
    SELECT COALESCE(SUM(signedAmount), 0) AS net
    FROM supplier_transactions
    WHERE supplierName = @supplierName
      AND date < @from
  `),
  page: db.prepare(`
    WITH filtered AS (
      SELECT *
      FROM supplier_transactions
      WHERE supplierName = @supplierName
        AND (@from IS NULL OR date >= @from)
        AND (@toExclusive IS NULL OR date < @toExclusive)
    ),
    with_balance AS (
      SELECT
        *,
        @openingBalance + SUM(signedAmount) OVER (
          ORDER BY date ASC, sourceRank ASC, id ASC
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ) AS balance
      FROM filtered
    )
    SELECT source, sourceRank, id, date, invoice, supplierName, total, type, balance
    FROM with_balance
    WHERE (
      @cursorDate IS NULL
      OR date < @cursorDate
      OR (date = @cursorDate AND sourceRank < @cursorRank)
      OR (date = @cursorDate AND sourceRank = @cursorRank AND id < @cursorId)
    )
    ORDER BY date DESC, sourceRank DESC, id DESC
    LIMIT @limitPlusOne
  `),
  all: db.prepare(`
    SELECT source, sourceRank, id, date, invoice, supplierName, total, type
    FROM supplier_transactions
    WHERE supplierName = @supplierName
      AND (@from IS NULL OR date >= @from)
      AND (@toExclusive IS NULL OR date < @toExclusive)
    ORDER BY date ASC, sourceRank ASC, id ASC
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

function parseRange({ from, to }) {
  const fromDate = normalizeDate(from);
  const toDate = normalizeDate(to);

  if (from && !fromDate) {
    throw validationError('Invalid "from" date. Use YYYY-MM-DD.');
  }
  if (to && !toDate) {
    throw validationError('Invalid "to" date. Use YYYY-MM-DD.');
  }
  if (fromDate && toDate && fromDate > toDate) {
    throw validationError('"from" date must be before "to" date.');
  }

  return {
    fromDate,
    toDate,
    toExclusive: toDate ? nextDay(toDate) : null
  };
}

function getOpeningBalance(supplierName, fromDate, fallbackOpening = 0) {
  const stored = statements.supplierBalance.get(supplierName);
  let openingBalance = stored
    ? Number(stored.supplierBalance) || 0
    : Number(fallbackOpening) || 0;

  if (fromDate) {
    const { net } = statements.netBeforeFrom.get({ supplierName, from: fromDate });
    openingBalance += Number(net) || 0;
  }

  return openingBalance;
}

function encodeCursor(row) {
  return Buffer.from(JSON.stringify({
    v: 1,
    d: row.date,
    r: row.sourceRank,
    i: row.id
  })).toString('base64url');
}

function decodeCursor(value) {
  if (!value) return null;

  try {
    const parsed = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'));
    if (
      parsed?.v !== 1 ||
      typeof parsed.d !== 'string' ||
      !Number.isInteger(parsed.r) ||
      !Number.isInteger(parsed.i)
    ) {
      throw new Error('Invalid cursor');
    }

    return {
      date: parsed.d,
      sourceRank: parsed.r,
      id: parsed.i
    };
  } catch {
    throw validationError('Invalid pagination cursor.');
  }
}

function getSummary(req, res) {
  const { supplierName } = req.query;
  if (!supplierName) {
    throw validationError('Supplier name is required.');
  }

  const { fromDate, toExclusive } = parseRange(req.query);
  const openingBalance = getOpeningBalance(supplierName, fromDate, req.query.openingBalance);
  const aggregate = statements.summary.get({
    supplierName,
    from: fromDate,
    toExclusive
  });

  const net = Number(aggregate.net) || 0;

  return res.status(200).json({
    supplierName,
    openingBalance,
    totalBills: Number(aggregate.totalBills) || 0,
    totalPayments: Number(aggregate.totalPayments) || 0,
    totalCreditNotes: Number(aggregate.totalCreditNotes) || 0,
    closingBalance: openingBalance + net,
    transactionCount: Number(aggregate.transactionCount) || 0
  });
}

function getTransactions(req, res) {
  const { supplierName, cursor } = req.query;
  if (!supplierName) {
    throw validationError('Supplier name is required.');
  }

  const { fromDate, toExclusive } = parseRange(req.query);
  const requestedLimit = Number(req.query.limit);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(Math.trunc(requestedLimit), 1), MAX_PAGE_SIZE)
    : DEFAULT_PAGE_SIZE;
  const decodedCursor = decodeCursor(cursor);
  const openingBalance = getOpeningBalance(supplierName, fromDate, req.query.openingBalance);

  const rows = statements.page.all({
    supplierName,
    from: fromDate,
    toExclusive,
    openingBalance,
    cursorDate: decodedCursor?.date ?? null,
    cursorRank: decodedCursor?.sourceRank ?? null,
    cursorId: decodedCursor?.id ?? null,
    limitPlusOne: limit + 1
  });

  const hasMore = rows.length > limit;
  const transactions = hasMore ? rows.slice(0, limit) : rows;
  const lastRow = transactions[transactions.length - 1];

  return res.status(200).json({
    transactions,
    nextCursor: hasMore && lastRow ? encodeCursor(lastRow) : null,
    hasMore
  });
}

/**
 * Backward-compatible full transaction endpoint used by statement PDFs.
 * The Ledger screen uses /summary and /transactions instead.
 */
function getAllRecords(req, res) {
  const { supplierName } = req.query;
  if (!supplierName) {
    throw validationError('Supplier name is required.');
  }

  const { fromDate, toExclusive } = parseRange(req.query);
  const openingBalance = getOpeningBalance(supplierName, fromDate, req.query.openingBalance);

  const rows = statements.all.all({
    supplierName,
    from: fromDate,
    toExclusive
  });

  let runningBalance = openingBalance;
  let totalBills = 0;
  let totalPayments = 0;
  let totalCreditNotes = 0;

  const transactions = rows.map((row) => {
    const amount = Number(row.total) || 0;

    if (row.type === 'Bill') {
      runningBalance += amount;
      totalBills += amount;
    } else {
      runningBalance -= amount;
      if (row.type === 'Credit Note') {
        totalCreditNotes += amount;
      } else {
        totalPayments += amount;
      }
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
      totalCreditNotes,
      closingBalance: runningBalance,
      transactionCount: transactions.length
    }
  });
}

export { getAllRecords, getSummary, getTransactions };
