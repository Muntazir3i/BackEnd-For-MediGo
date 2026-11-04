import express from 'express';
import {
  fetchAllMedicines,
  updateMedicineById,
  deleteMedicineById
} from '../controllers/MedicinesControllerSql.js';

const router = express.Router();

// Route to fetch a list of all available medicines
router.get('/medicines', (req, res) => {
  try {
    const medicines = fetchAllMedicines();
    res.json(medicines);
  } catch (error) {
    console.error('Error fetching medicines:', error);
    res.status(500).json({ error: 'Failed to fetch medicines' });
  }
});

// Route to update a single medicine row
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
    res.status(400).json({ error: error.message || 'Failed to update medicine' });
  }
});

// Route to delete a single medicine row
router.delete('/medicines/:id', (req, res) => {
  try {
    const result = deleteMedicineById(req.params.id);

    if (!result.deleted) {
      return res.status(404).json({ error: 'Medicine not found' });
    }

    res.json({
      message: 'Medicine deleted successfully',
      ...result
    });
  } catch (error) {
    console.error('Error deleting medicine:', error);
    res.status(400).json({ error: error.message || 'Failed to delete medicine' });
  }
});

export default router;
