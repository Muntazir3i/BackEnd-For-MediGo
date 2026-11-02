import express from 'express';
import { addBill, fetchBillsWithProducts, fetchSupplierSummaries } from '../controllers/billControllerSql.js';

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

// Route to fetch the supplier list with bill counts and totals.
// Query param: search (optional supplier name filter)
router.get('/bills/suppliers', (req, res) => {
  try {
    const suppliers = fetchSupplierSummaries(req.query.search || '');
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
