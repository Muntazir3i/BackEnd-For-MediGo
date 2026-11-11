import express from "express";
import {
    saveInvoice,
    getInvoicesByDateAndCustomer,
    getInvoice,
    deleteInvoice,
    updateInvoice,
    voidInvoice
} from "../controllers/invoiceController.js";

const router = express.Router();

// Save/finalize a sale and deduct stock
router.post("/save", saveInvoice);

// Search invoices by date and customer name
router.get("/search", getInvoicesByDateAndCustomer);

// Fetch one invoice with its immutable line snapshots
router.get("/:id", getInvoice);

// Edit a sale and reconcile stock against the new lines
router.put("/:id", updateInvoice);

// Delete a customer invoice and restore its stock
router.delete("/:id", deleteInvoice);

// Void a sale and restore stock
router.post("/:id/void", voidInvoice);

export default router;
