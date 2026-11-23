import express from 'express';
import { getInsights, getMedicinePurchaseStats, getMedicinePriceHistory, getMarginDashboard } from '../controllers/insightsController.js';

const router = express.Router();

router.get('/medicines', (req, res) => {
  try {
    getMedicinePurchaseStats(req, res);
  } catch (error) {
    console.error('Error building medicine purchase stats:', error);
    res.status(500).json({ error: error.message || 'Failed to build medicine stats' });
  }
});

router.get('/price-history', (req, res) => {
  try {
    getMedicinePriceHistory(req, res);
  } catch (error) {
    console.error('Error building medicine price history:', error);
    res.status(500).json({ error: error.message || 'Failed to build medicine price history' });
  }
});

router.get('/margins', (req, res) => {
  try {
    getMarginDashboard(req, res);
  } catch (error) {
    console.error('Error building margin dashboard:', error);
    res.status(500).json({ error: error.message || 'Failed to build margin dashboard' });
  }
});

router.get('/', (req, res) => {
  try {
    getInsights(req, res);
  } catch (error) {
    console.error('Error building insights:', error);
    res.status(500).json({ error: error.message || 'Failed to build insights' });
  }
});

export default router;
