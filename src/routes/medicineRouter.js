import express from 'express';
import { fetchAllMedicines } from '../controllers/MedicinesControllerSql.js';

const router = express.Router();

router.get('/medicines', (req, res) => {
  try {
    const medicines = fetchAllMedicines();
    res.json(medicines);
  } catch (error) {
    console.error('Error fetching medicines:', error);
    res.status(500).json({ error: 'Failed to fetch medicines' });
  }
});

export default router;