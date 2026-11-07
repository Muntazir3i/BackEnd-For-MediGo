import express from 'express';
import {
  addCreditNote,
  deleteCreditNote,
  getCreditNoteById,
  getCreditNotes,
  updateCreditNote
} from '../controllers/creditNoteController.js';

const router = express.Router();

function sendError(res, error, fallback) {
  const status = error.statusCode || 500;
  res.status(status).json({ error: error.message || fallback });
}

// List credit notes with optional text search and date range.
router.get('/', (req, res) => {
  try {
    res.json(getCreditNotes({
      search: req.query.search || '',
      from: req.query.from || '',
      to: req.query.to || '',
      supplierName: req.query.supplierName || ''
    }));
  } catch (error) {
    console.error('Error fetching credit notes:', error);
    sendError(res, error, 'Failed to fetch credit notes');
  }
});

router.get('/:id', (req, res) => {
  try {
    res.json(getCreditNoteById(req.params.id));
  } catch (error) {
    console.error('Error fetching credit note:', error);
    sendError(res, error, 'Failed to fetch credit note');
  }
});

router.post('/', (req, res) => {
  try {
    res.status(201).json(addCreditNote(req.body));
  } catch (error) {
    console.error('Error saving credit note:', error);
    sendError(res, error, 'Failed to save credit note');
  }
});

router.put('/:id', (req, res) => {
  try {
    res.json(updateCreditNote(req.params.id, req.body));
  } catch (error) {
    console.error('Error updating credit note:', error);
    sendError(res, error, 'Failed to update credit note');
  }
});

router.delete('/:id', (req, res) => {
  try {
    res.json(deleteCreditNote(req.params.id));
  } catch (error) {
    console.error('Error deleting credit note:', error);
    sendError(res, error, 'Failed to delete credit note');
  }
});

export default router;
