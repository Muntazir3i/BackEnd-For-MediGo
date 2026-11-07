import express from 'express';
import {
  addExpiryRecord,
  deleteExpiryRecord,
  findExpiryRecordsBySupplier,
  getAllExpiryRecords
} from '../controllers/expiryController.js';

const router = express.Router();

function sendError(res, error, fallback) {
  const status = error.statusCode || 500;
  res.status(status).json({ error: error.message || fallback });
}

// Save a distributor expiry record with its medicine lines.
router.post('/add-expiry', (req, res) => {
  try {
    const result = addExpiryRecord(req.body);
    res.status(201).json(result);
  } catch (error) {
    console.error('Error saving expiry record:', error);
    sendError(res, error, 'Failed to save expiry record');
  }
});

// Full digital expiry register.
router.get('/all-expiry', (req, res) => {
  try {
    res.json(getAllExpiryRecords());
  } catch (error) {
    console.error('Error fetching expiry records:', error);
    sendError(res, error, 'Failed to fetch expiry records');
  }
});

// Expiry records for one distributor.
router.get('/find-exp/:name', (req, res) => {
  try {
    res.json(findExpiryRecordsBySupplier(req.params.name));
  } catch (error) {
    console.error('Error fetching supplier expiry records:', error);
    sendError(res, error, 'Failed to fetch supplier expiry records');
  }
});

// Remove an incorrectly entered record.
router.delete('/:id', (req, res) => {
  try {
    res.json(deleteExpiryRecord(req.params.id));
  } catch (error) {
    console.error('Error deleting expiry record:', error);
    sendError(res, error, 'Failed to delete expiry record');
  }
});

export default router;
