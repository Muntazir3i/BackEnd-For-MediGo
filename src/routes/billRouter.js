import express from 'express';
import { addBill, deleteBill, fetchBillsWithProducts, fetchSupplierSummaries } from '../controllers/billControllerSql.js';

const router = express.Router();

// Route to create a new bill
router.post('/bills', (req, res) => {
  try {
    const result = addBill(req.body);
    res.status(201).json(result);
  } catch (error) {
    console.error('Error saving bill:', error);
    res.status(500).json({ error: 'Failed to save bill' });
  }
});

// Route to delete a purchase bill and all of its product rows
router.delete('/bills/:id', (req, res) => {
  try {
    const result = deleteBill(req.params.id);

    if (!result.deleted) {
      return res.status(404).json({ error: 'Bill not found' });
    }

    res.json({
      message: 'Bill and related products deleted successfully',
      ...result
    });
  } catch (error) {
    console.error('Error deleting bill:', error);
    res.status(400).json({ error: error.message || 'Failed to delete bill' });
  }
});

// Route to fetch the supplier list with bill counts and totals.
// Query params: search (optional supplier name filter), date (optional),
// invoice (optional partial bill number filter).
router.get('/bills/suppliers', (req, res) => {
  try {
    const { search, date, invoice } = req.query;
    const suppliers = fetchSupplierSummaries({ search, date, invoice });
    res.json(suppliers);
  } catch (error) {
    console.error('Error fetching bill suppliers:', error);
    res.status(500).json({ error: 'Failed to fetch bill suppliers' });
  }
});

// Route to fetch a page of bills with their associated products.
// Query params: limit (default 5), offset (default 0),
// supplierName (optional, exact), date (optional), invoice (optional)
router.get('/bills', (req, res) => {
  try {
    const { limit, offset, supplierName, supplierSearch, date, invoice } = req.query;
    const bills = fetchBillsWithProducts({ limit, offset, supplierName, supplierSearch, date, invoice });
    res.json(bills);
  } catch (error) {
    console.error('Error fetching bills:', error);
    res.status(500).json({ error: 'Failed to fetch bills' });
  }
});

export default router;
