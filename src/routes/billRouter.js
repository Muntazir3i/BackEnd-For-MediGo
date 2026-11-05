import express from 'express';
import {
  addBill,
  deleteBill,
  fetchBillsWithProducts,
  fetchSupplierSummaries,
  updateBill
} from '../controllers/billControllerSql.js';

const router = express.Router();

function sendError(res, error, fallback) {
  const status = error.statusCode || 400;
  res.status(status).json({ error: error.message || fallback });
}

// Route to create a new purchase bill and receive its stock
router.post('/bills', (req, res) => {
  try {
    const result = addBill(req.body);
    res.status(201).json(result);
  } catch (error) {
    console.error('Error saving bill:', error);
    sendError(res, error, 'Failed to save bill');
  }
});

// Route to update a purchase bill and apply stock deltas
router.put('/bills/:id', (req, res) => {
  try {
    const result = updateBill(req.params.id, req.body);

    if (!result.updated) {
      return res.status(404).json({ error: 'Bill not found' });
    }

    res.json({
      message: 'Bill updated successfully',
      ...result
    });
  } catch (error) {
    console.error('Error updating bill:', error);
    sendError(res, error, 'Failed to update bill');
  }
});

// Route to void a purchase bill and reverse stock when possible
router.delete('/bills/:id', (req, res) => {
  try {
    const result = deleteBill(req.params.id);

    if (!result.deleted) {
      if (result.alreadyVoid) {
        return res.status(409).json({ error: 'This bill has already been voided.' });
      }
      return res.status(404).json({ error: 'Bill not found' });
    }

    res.json({
      message: 'Bill voided successfully',
      ...result
    });
  } catch (error) {
    console.error('Error voiding bill:', error);
    sendError(res, error, 'Failed to void bill');
  }
});

// Route to fetch the supplier list with bill counts and totals.
router.get('/bills/suppliers', (req, res) => {
  try {
    const { search, date, invoice } = req.query;
    res.json(fetchSupplierSummaries({ search, date, invoice }));
  } catch (error) {
    console.error('Error fetching bill suppliers:', error);
    sendError(res, error, 'Failed to fetch bill suppliers');
  }
});

// Route to fetch a page of bills with their line-item snapshots.
router.get('/bills', (req, res) => {
  try {
    const { limit, offset, supplierName, supplierSearch, date, invoice } = req.query;
    res.json(fetchBillsWithProducts({ limit, offset, supplierName, supplierSearch, date, invoice }));
  } catch (error) {
    console.error('Error fetching bills:', error);
    sendError(res, error, 'Failed to fetch bills');
  }
});

export default router;
