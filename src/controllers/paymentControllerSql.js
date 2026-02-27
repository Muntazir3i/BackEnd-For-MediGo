import db from '../db/billPayment.js';

function addPayment(payment) {
  const insert = db.prepare(`
    INSERT INTO payments (id, date, invoice, supplierName, drugLicenseNumber, total,type)
    VALUES (?, ?, ?, ?, ?, ?,?)
  `);

  insert.run(
    payment.id,
    payment.date,
    payment.invoice,
    payment.supplierName,
    payment.drugLicenseNumber,
    payment.total,
    payment.type,
  );

  return { message: 'Payment recorded', paymentId: payment.id };
}

function fetchAllPayments() {
  const query = db.prepare(`
    SELECT * FROM payments
  `);

  return query.all(); // Fetches all rows from the payments table
}

// Function to fetch payments by date
function fetchPaymentsByDate(date) {
  const query = db.prepare(`
    SELECT * FROM payments WHERE date = ?
  `);

  return query.all(date); // Fetches payments where the date matches
}

function deletePayment(paymentId) {
  const del = db.prepare(`
    DELETE FROM payments WHERE id = ?
  `);

  del.run(paymentId);
  return { message: 'Payment deleted', paymentId };
}

function updatePayment(payment) {
  const update = db.prepare(`
    UPDATE payments
    SET date = ?, invoice = ?, supplierName = ?, drugLicenseNumber = ?, total = ?, type = ?
    WHERE id = ?
  `);

  update.run(
    payment.date,
    payment.invoice,
    payment.supplierName,
    payment.drugLicenseNumber,
    payment.total,
    payment.type,
    payment.id
  );

  return { message: 'Payment updated', paymentId: payment.id };
}


export { addPayment,fetchAllPayments,fetchPaymentsByDate, deletePayment, updatePayment };