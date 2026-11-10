import express from 'express';
import { getShopSettings, updateShopSettings } from '../controllers/settingsController.js';

const router = express.Router();

// Read the single shop settings row.
router.get('/', (req, res) => {
  try {
    res.json(getShopSettings());
  } catch (error) {
    console.error('Error fetching shop settings:', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to fetch shop settings' });
  }
});

// Update one or more settings fields.
router.put('/', (req, res) => {
  try {
    res.json(updateShopSettings(req.body));
  } catch (error) {
    console.error('Error saving shop settings:', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to save shop settings' });
  }
});

export default router;
