import express from 'express';
import { getInsights } from '../controllers/insightsController.js';

const router = express.Router();

router.get('/', (req, res) => {
  try {
    getInsights(req, res);
  } catch (error) {
    console.error('Error building insights:', error);
    res.status(500).json({ error: error.message || 'Failed to build insights' });
  }
});

export default router;
