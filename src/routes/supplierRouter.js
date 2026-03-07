import express from 'express';
import { addSupplier, getAllSuppliers } from '../controllers/supplierController.js';

const router = express.Router();

// Route to add a new supplier
router.post('/suppliers', (req, res) => {
  const { supplierName, phoneNumber, drugLn, supplierBalance } = req.body;

  if (!supplierName) {
    return res.status(400).json({ error: 'Name is required' });
  }

  try {
    const id = addSupplier({ supplierName, phoneNumber, drugLn, supplierBalance });
    res.status(201).json({ message: 'Supplier added', supplierId: id });
  } catch (error) {
    console.error('Error saving supplier:', error);
    res.status(500).json({ error: 'Failed to save supplier' });
  }
});

// Route to fetch all suppliers
router.get('/suppliers', (req, res) => {
  try {
    const suppliers = getAllSuppliers();
    res.json(suppliers);
  } catch (error) {
    console.error('Error fetching suppliers:', error);
    res.status(500).json({ error: 'Failed to fetch suppliers' });
  }
});

export default router;