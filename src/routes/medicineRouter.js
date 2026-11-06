import express from 'express';
import {
  adjustStockById,
  createSalt,
  deleteMedicineById,
  fetchAllMedicines,
  fetchExpiringInventory,
  fetchLowStockProducts,
  fetchMedicineById,
  fetchOutOfStockProducts,
  fetchSalts,
  updateMedicineById
} from '../controllers/MedicinesControllerSql.js';

const router = express.Router();

function sendError(res, error, fallback) {
  const status = error.statusCode || 400;
  res.status(status).json({ error: error.message || fallback });
}

// Route to fetch a list of available inventory batches
router.get('/medicines', (req, res) => {
  try {
    res.json(fetchAllMedicines());
  } catch (error) {
    console.error('Error fetching medicines:', error);
    sendError(res, error, 'Failed to fetch medicines');
  }
});

// Salt catalogue search (optional salt assignment UI)
router.get('/salts', (req, res) => {
  try {
    const search = req.query.search ?? req.query.q ?? '';
    res.json(fetchSalts(search));
  } catch (error) {
    console.error('Error fetching salts:', error);
    sendError(res, error, 'Failed to fetch salts');
  }
});

// Create or reuse a salt by name
router.post('/salts', (req, res) => {
  try {
    const salt = createSalt(req.body);
    res.status(201).json(salt);
  } catch (error) {
    console.error('Error creating salt:', error);
    sendError(res, error, 'Failed to create salt');
  }
});

// Dashboard stock indicators (aggregated across active batches)
router.get('/low-stock', (req, res) => {
  try {
    res.json(fetchLowStockProducts());
  } catch (error) {
    console.error('Error fetching low stock:', error);
    sendError(res, error, 'Failed to fetch low stock products');
  }
});

router.get('/out-of-stock', (req, res) => {
  try {
    res.json(fetchOutOfStockProducts());
  } catch (error) {
    console.error('Error fetching out of stock:', error);
    sendError(res, error, 'Failed to fetch out of stock products');
  }
});

// Batches expiring between today and three months from now
router.get('/expiry-stock', (req, res) => {
  try {
    const months = Number(req.query.months) || 3;
    res.json(fetchExpiringInventory({ months }));
  } catch (error) {
    console.error('Error fetching expiring stock:', error);
    sendError(res, error, 'Failed to fetch expiring stock');
  }
});

// Route to fetch one inventory batch
router.get('/medicines/:id', (req, res) => {
  try {
    const medicine = fetchMedicineById(req.params.id);

    if (!medicine) {
      return res.status(404).json({ error: 'Medicine not found' });
    }

    res.json(medicine);
  } catch (error) {
    console.error('Error fetching medicine:', error);
    sendError(res, error, 'Failed to fetch medicine');
  }
});

// Route to update metadata and, when intentionally supplied, adjust stock
router.put('/medicines/:id', (req, res) => {
  try {
    const result = updateMedicineById(req.params.id, req.body);

    if (!result.updated) {
      return res.status(404).json({ error: 'Medicine not found' });
    }

    res.json({
      message: 'Medicine updated successfully',
      ...result
    });
  } catch (error) {
    console.error('Error updating medicine:', error);
    sendError(res, error, 'Failed to update medicine');
  }
});

// Audited stock adjustment endpoint
router.post('/medicines/:id/adjust', (req, res) => {
  try {
    const result = adjustStockById(req.params.id, req.body);
    res.json({
      message: 'Stock adjusted successfully',
      ...result
    });
  } catch (error) {
    console.error('Error adjusting stock:', error);
    sendError(res, error, 'Failed to adjust stock');
  }
});

// Route to deactivate an inventory batch (never a hard delete)
router.delete('/medicines/:id', (req, res) => {
  try {
    const result = deleteMedicineById(req.params.id);

    if (!result.deleted) {
      return res.status(404).json({ error: 'Medicine not found' });
    }

    res.json({
      message: 'Medicine deactivated successfully',
      ...result
    });
  } catch (error) {
    console.error('Error deleting medicine:', error);
    sendError(res, error, 'Failed to delete medicine');
  }
});

export default router;
