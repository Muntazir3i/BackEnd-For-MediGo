import express from "express";
import {
    saveInvoice,
    getInvoicesByDateAndCustomer,
    getInvoice,
    voidInvoice
} from "../controllers/invoiceController.js";

const router = express.Router();

// Save/finalize a sale and deduct stock
router.post("/save", saveInvoice);

// Search invoices by date and customer name
router.get("/search", getInvoicesByDateAndCustomer);

// Fetch one invoice with its immutable line snapshots
router.get("/:id", getInvoice);

// Void a sale and restore stock
router.post("/:id/void", voidInvoice);

export default router;
