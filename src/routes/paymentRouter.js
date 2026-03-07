import express from 'express';
import {
  addPayment,
  fetchAllPayments,
  fetchPaymentsByDate,
  deletePayment,
  updatePayment,
  findPaymentByInvoice,
} from '../controllers/paymentControllerSql.js';

const router = express.Router();

router.post('/payments', (req, res) => {
  try {
    const payment = findPaymentByInvoice(req.body.invoice);
    if (payment) {
      return res.status(400).json({ error: 'Payment already exists' });
    }
    const result = addPayment(req.body);
    res.status(201).json(result);
  } catch (error) {
    console.error('Error saving payment:', error);
    res.status(500).json({ error: 'Failed to save payment' });
  }
});

router.get('/payments', (req, res) => {
  try {
    const payments = fetchAllPayments();
    res.json(payments);
  } catch (error) {
    console.error('Error fetching payments:', error);
    res.status(500).json({ error: 'Failed to fetch payments' });
  }
});

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