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
  fetchAllPayments: db.prepare(`
    SELECT * FROM payments
    ORDER BY id DESC
    LIMIT 50
  `),
  fetchPaymentsByDate: db.prepare(`
    SELECT * FROM payments WHERE date = ?
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

function fetchAllPayments() {
  return statements.fetchAllPayments.all();
}

function fetchPaymentsByDate(date) {
  return statements.fetchPaymentsByDate.all(date);
}

function deletePayment(paymentId) {
  const info = statements.deletePayment.run(paymentId);
  return {
    message: info.changes > 0 ? 'Payment deleted' : 'Payment not found',
    paymentId,
    deleted: info.changes > 0
  };
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
  findPaymentByInvoice
};