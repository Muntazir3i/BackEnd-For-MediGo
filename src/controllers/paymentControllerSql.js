/**
 * Controller for managing payment-related database operations using SQLite.
 * 
 * This controller handles CRUD operations for payments, including adding new
 * payments, fetching payments by various criteria (invoice, date), updating
 * existing payments, and deleting payments.
 */
import db from '../db/billPayment.js';

// 1. Pre-compile statements for better performance
// This avoids parsing the SQL string on every function call.
const statements = {
  addPayment: db.prepare(`
    INSERT INTO payments (id, date, invoice, supplierName, drugLicenseNumber, total, type)
    VALUES (@id, @date, @invoice, @supplierName, @drugLicenseNumber, @total, @type)
  `),
  findPaymentByInvoice: db.prepare(`
    SELECT * FROM payments WHERE invoice = ?
  `),
  fetchPaymentsPage: db.prepare(`
    SELECT *
    FROM payments
    WHERE (@lastId IS NULL OR id < @lastId)
      AND (@invoice IS NULL OR invoice LIKE @invoice)
      AND (@from IS NULL OR date >= @from)
      AND (@to IS NULL OR date < @to)
    ORDER BY id DESC
    LIMIT 50
  `),
  fetchPaymentsByDate: db.prepare(`
    SELECT id, date, invoice, supplierName, total, COALESCE(type, 'Payment') AS type
    FROM payments
    WHERE date >= @from AND date < @to
    ORDER BY date ASC, id ASC
  `),
  summarizePaymentsByDate: db.prepare(`
    SELECT COUNT(*) AS count, COALESCE(SUM(total), 0) AS total
    FROM payments
    WHERE date >= @from AND date < @to
  `),
  deletePayment: db.prepare(`
    DELETE FROM payments WHERE id = ?
  `),
  updatePayment: db.prepare(`
    UPDATE payments
    SET date = @date, invoice = @invoice, supplierName = @supplierName, drugLicenseNumber = @drugLicenseNumber, total = @total, type = @type
    WHERE id = @id
  `)
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function normalizeDate(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return DATE_PATTERN.test(trimmed) ? trimmed : null;
}

// Exclusive upper bound so payments stored with a time component are included.
function nextDay(date) {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString().slice(0, 10);
}

// Partial invoice search: "%123%" so any matching invoice number is returned.
function normalizeInvoice(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed !== '' ? `%${trimmed}%` : null;
}

/**
 * Turn inclusive YYYY-MM-DD bounds into the exclusive upper bound used by the
 * SQL filters, so rows stored with a time component on the end date still match.
 */
function normalizeDateRange(from, to) {
  const start = normalizeDate(from);
  const end = normalizeDate(to);

  return {
    from: start,
    to: end ? nextDay(end) : null
  };
}

function addPayment(payment) {
  // 2. Use named parameters with fallbacks to avoid crashes if keys are missing/undefined
  statements.addPayment.run({
    id: payment.id,
    date: payment.date || null,
    invoice: payment.invoice || null,
    supplierName: payment.supplierName || null,
    drugLicenseNumber: payment.drugLicenseNumber || null,
    total: payment.total || 0,
    type: payment.type || null
  });

  return { message: 'Payment recorded', paymentId: payment.id };
}

function findPaymentByInvoice(invoice) {
  return statements.findPaymentByInvoice.get(invoice);
}

function fetchAllPayments(invoice = '', { from = '', to = '' } = {}) {
  return statements.fetchPaymentsPage.all({
    lastId: null,
    invoice: normalizeInvoice(invoice),
    ...normalizeDateRange(from, to)
  });
}

function fetchPaymentsByDate(date) {
  const from = normalizeDate(date);

  if (!from) {
    return {
      date: date || '',
      payments: [],
      summary: { count: 0, total: 0 }
    };
  }

  const to = nextDay(from);

  return {
    date: from,
    payments: statements.fetchPaymentsByDate.all({ from, to }),
    summary: statements.summarizePaymentsByDate.get({ from, to })
  };
}

function deletePayment(paymentId) {
  const info = statements.deletePayment.run(paymentId);
  return {
    message: info.changes > 0 ? 'Payment deleted' : 'Payment not found',
    paymentId,
    deleted: info.changes > 0
  };
}

function loadMorePayments(lastId, invoice = '', { from = '', to = '' } = {}) {
  const numericId = Number(lastId);

  if (!Number.isFinite(numericId)) return [];

  return statements.fetchPaymentsPage.all({
    lastId: numericId,
    invoice: normalizeInvoice(invoice),
    ...normalizeDateRange(from, to)
  });
}

function updatePayment(payment) {
  const info = statements.updatePayment.run({
    id: payment.id,
    date: payment.date || null,
    invoice: payment.invoice || null,
    supplierName: payment.supplierName || null,
    drugLicenseNumber: payment.drugLicenseNumber || null,
    total: payment.total || 0,
    type: payment.type || null
  });

  return {
    message: info.changes > 0 ? 'Payment updated' : 'Payment not found',
    paymentId: payment.id,
    updated: info.changes > 0
  };
}

export {
  addPayment,
  fetchAllPayments,
  fetchPaymentsByDate,
  deletePayment,
  updatePayment,
  findPaymentByInvoice,
  loadMorePayments
};