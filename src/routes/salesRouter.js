import express from 'express';
import {
  getInvoice,
  getInvoicesByDateAndCustomer,
  saveInvoice,
  deleteInvoice,
  voidInvoice
} from '../controllers/invoiceController.js';

const router = express.Router();

// Finalize a sale, snapshot its lines and deduct stock
router.post('/invoices', saveInvoice);

// Search/list sale invoices
router.get('/invoices', getInvoicesByDateAndCustomer);

// Fetch one invoice with its full snapshot
router.get('/invoices/:id', getInvoice);

// Delete a sale and restore its stock
router.delete('/invoices/:id', deleteInvoice);

// Void a sale and restore its stock
router.post('/invoices/:id/void', voidInvoice);

export default router;
