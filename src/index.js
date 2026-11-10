// Schema setup must be evaluated before controllers prepare their statements.
import './setup/createInventorySchema.js'
import './setup/createSupplierTable.js'
import './setup/createBillsPaymnetTable.js'
import './setup/createExpirySchema.js'
import './setup/createCreditNoteSchema.js'
import './setup/createLedgerSchema.js'
import './setup/createSettingsSchema.js'

import express from 'express'
import supplierRoutes from './routes/supplierRouter.js'
import billRouterSql from './routes/billRouter.js'
import paymentRouterSql from './routes/paymentRouter.js'
import billPaymentRouterSql from './routes/billPaymentRouter.js'
import allMedicinesRouterSql from './routes/medicineRouter.js'
import searchMedicineRouterSql from './routes/searchMedicineRouter.js'
import invoiceRoutes from './routes/invoiceRoutes.js'
import salesRoutes from './routes/salesRouter.js'
import expiryRoutes from './routes/expiryRouter.js'
import creditNoteRoutes from './routes/creditNoteRouter.js'
import insightsRoutes from './routes/insightsRouter.js'
import settingsRoutes from './routes/settingsRouter.js'
import cors from 'cors'
import billScanRouter from './routes/billScan.js'
import 'dotenv/config'

const app = express();
const PORT = 8008;

app.use(cors());

// middleware to parse JSON request body
app.use(express.json({ limit: '20mb' }));

app.use(billScanRouter);

// routes
app.use('/api/supplier', supplierRoutes)
app.use('/api/sqlbills', billRouterSql);
app.use('/api/sqlpayment', paymentRouterSql);
app.use('/api/sqlbillpayment', billPaymentRouterSql)
app.use('/api/sqlmedicines', allMedicinesRouterSql)
app.use('/api/searchMedicine', searchMedicineRouterSql)
app.use("/api/invoice", invoiceRoutes);
app.use("/api/sales", salesRoutes);
app.use("/api/expiry", expiryRoutes);
app.use("/api/credit-notes", creditNoteRoutes);
app.use("/api/insights", insightsRoutes);
app.use("/api/settings", settingsRoutes);

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
