import express from "express";

import {
    saveInvoice,
    getInvoicesByDateAndCustomer
} from "../controllers/invoiceController.js";

const router = express.Router();

// save invoice
router.post("/save", saveInvoice);

// get invoice by date + customer
router.get("/search", getInvoicesByDateAndCustomer);

export default router;