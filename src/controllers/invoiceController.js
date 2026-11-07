/**
 * Invoice controller.
 *
 * Sales invoices are now stored in SQL (invoices / invoice_items) instead of
 * daily JSON files. The legacy response shape is preserved for the dashboard:
 * every invoice still exposes `customer` and `medicines` arrays.
 */
import {
  createSaleInvoice,
  deleteSaleInvoice,
  getSaleInvoice,
  listInvoices,
  voidSaleInvoice
} from '../services/salesInvoiceService.js';

function sendError(res, error, fallback) {
  const status = error.statusCode || 500;
  res.status(status).json({
    success: false,
    message: error.message || fallback
  });
}

export const saveInvoice = (req, res) => {
  try {
    const result = createSaleInvoice(req.body);
    res.status(result.duplicate ? 200 : 201).json({
      success: true,
      message: result.duplicate ? 'Invoice already saved' : 'Invoice Saved',
      duplicate: result.duplicate,
      invoice: result.invoice
    });
  } catch (error) {
    console.error('Error saving invoice:', error);
    sendError(res, error, 'Error saving invoice');
  }
};

export const getInvoicesByDateAndCustomer = (req, res) => {
  try {
    const { date = '', customer = '', invoice = '', limit = 500 } = req.query;
    res.json(listInvoices({ date, customer, invoice, limit }));
  } catch (error) {
    console.error('Error fetching invoices:', error);
    sendError(res, error, 'Error fetching invoices');
  }
};

export const getInvoice = (req, res) => {
  try {
    const invoice = getSaleInvoice(req.params.id);

    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }

    res.json(invoice);
  } catch (error) {
    console.error('Error fetching invoice:', error);
    sendError(res, error, 'Error fetching invoice');
  }
};

export const deleteInvoice = (req, res) => {
  try {
    const result = deleteSaleInvoice(req.params.id);

    if (!result.deleted) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }

    res.json({
      success: true,
      message: 'Invoice deleted successfully',
      invoice: result.invoice
    });
  } catch (error) {
    console.error('Error deleting invoice:', error);
    sendError(res, error, 'Error deleting invoice');
  }
};

export const voidInvoice = (req, res) => {
  try {
    const result = voidSaleInvoice(req.params.id);

    if (!result.voided) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }

    res.json({
      success: true,
      message: 'Invoice voided successfully',
      invoice: result.invoice
    });
  } catch (error) {
    console.error('Error voiding invoice:', error);
    sendError(res, error, 'Error voiding invoice');
  }
};
