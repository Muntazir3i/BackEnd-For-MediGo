import express from 'express';
import {
  addPayment,
  fetchAllPayments,
  fetchPaymentsByDate,
  deletePayment,
  updatePayment,
  findPaymentByInvoice,
  loadMorePayments
} from '../controllers/paymentControllerSql.js';

const router = express.Router();

// Route to record a new payment
router.post('/payments', (req, res) => {
  try {
    const result = addPayment(req.body);
    res.status(201).json(result);
  } catch (error) {
    console.error('Error saving payment:', error);
    res.status(500).json({ error: 'Failed to save payment' });
  }
});

// Route to fetch all payment records
router.get('/payments', (req, res) => {
  try {
    const payments = fetchAllPayments();
    res.json(payments);
  } catch (error) {
    console.error('Error fetching payments:', error);
    res.status(500).json({ error: 'Failed to fetch payments' });
  }
});

// Route to fetch paginated payment records after a specific ID
router.get('/payments/loadMore/:lastId', (req, res) => {
  try {
    const lastId = req.params.lastId;
    const payments = loadMorePayments(lastId);
    res.json(payments);
  } catch (error) {
    console.error('Error fetching payments:', error);
    res.status(500).json({ error: 'Failed to fetch payments' });
  }
});

// Route to fetch payment records filtered by a specific date
router.get('/payments/date/:date', (req, res) => {
  try {
    const date = req.params.date;
    const payments = fetchPaymentsByDate(date);
    res.json(payments);
  } catch (error) {
    console.error('Error fetching payments by date:', error);
    res.status(500).json({ error: 'Failed to fetch payments by date' });
  }
});

// Route to delete a specific payment record by its ID
router.delete('/payments/:id', (req, res) => {
  try {
    const paymentId = req.params.id;
    const result = deletePayment(paymentId);

    // Using the flag from the updated controller
    if (!result.deleted) {
      return res.status(404).json({ error: 'Payment not found' });
    }
    res.json(result);
  } catch (error) {
    console.error('Error deleting payment:', error);
    res.status(500).json({ error: 'Failed to delete payment' });
  }
});

// Route to update an existing payment record
router.put('/payments/:id', (req, res) => {
  try {
    const paymentId = req.params.id;
    const updatedPayment = req.body;

    const result = updatePayment({ ...updatedPayment, id: paymentId });

    // Using the flag from the updated controller
    if (!result.updated) {
      return res.status(404).json({ error: 'Payment not found' });
    }
    res.json(result);
  } catch (error) {
    console.error('Error updating payment:', error);
    res.status(500).json({ error: 'Failed to update payment' });
  }
});

export default router;