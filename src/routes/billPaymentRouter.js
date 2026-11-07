import express from 'express';
import { getAllRecords, getSummary, getTransactions } from '../controllers/billPaymentController.js';

const router = express.Router();

function sendError(res, error, fallback) {
  const status = error.statusCode || 500;
  res.status(status).json({ error: error.message || fallback });
}

// Aggregate balance and totals for one supplier.
router.get('/summary', (req, res) => {
  try {
    getSummary(req, res);
  } catch (error) {
    console.error('Error fetching supplier ledger summary:', error);
    sendError(res, error, 'Failed to fetch supplier ledger summary');
  }
});

// Newest-first cursor-paginated transaction history.
router.get('/transactions', (req, res) => {
  try {
    getTransactions(req, res);
  } catch (error) {
    console.error('Error fetching supplier transactions:', error);
    sendError(res, error, 'Failed to fetch supplier transactions');
  }
});

// Backward-compatible full transaction endpoint used by statement PDFs.
router.get('/all-data', (req, res) => {
  try {
    getAllRecords(req, res);
  } catch (error) {
    console.error('Error fetching supplier transactions:', error);
    sendError(res, error, 'Failed to fetch supplier transactions');
  }
});

export default router;
