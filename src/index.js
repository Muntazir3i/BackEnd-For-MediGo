// Environment and pending restores must be evaluated before any DB import.
import 'dotenv/config'
import './setup/applyPendingRestore.js'

// Schema setup must be evaluated before controllers prepare their statements.
import './setup/createInventorySchema.js'
import './setup/createSupplierTable.js'
import './setup/createBillsPaymnetTable.js'
import './setup/createExpirySchema.js'
import './setup/createCreditNoteSchema.js'
import './setup/createLedgerSchema.js'
import './setup/createSettingsSchema.js'

import express from 'express'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import https from 'https'
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
import registerRoutes from './routes/registerRouter.js'
import backupRoutes from './routes/backupRouter.js'
import { startBackupScheduler } from './services/backupService.js'
import cors from 'cors'
import billScanRouter from './routes/billScan.js'

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
app.use("/api/registers", registerRoutes);
app.use("/api/backups", backupRoutes);

// Serve the built frontend when it exists, so the laptop can act as the single
// server for phones and other devices on the same network.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendDist = path.resolve(__dirname, '../../MediGo/dist');

if (fs.existsSync(frontendDist)) {
    app.use(express.static(frontendDist));
    app.use((req, res, next) => {
        if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
        res.sendFile(path.join(frontendDist, 'index.html'));
    });
    console.log(`Serving frontend from ${frontendDist}`);
}

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on http://localhost:${PORT}`);
    console.log(`Phone/LAN access: http://<laptop-ip>:${PORT}`);
    startBackupScheduler();
});

// Optional HTTPS listener for phone camera access. Browsers only allow camera
// access on HTTPS or localhost, so a phone on the LAN needs this when scanning.
const certDir = path.resolve('certs');
const httpsKeyPath = path.join(certDir, 'local.key');
const httpsCertPath = path.join(certDir, 'local.crt');
const HTTPS_PORT = Number(process.env.HTTPS_PORT) || 8443;

if (fs.existsSync(httpsKeyPath) && fs.existsSync(httpsCertPath)) {
    https
        .createServer(
            {
                key: fs.readFileSync(httpsKeyPath),
                cert: fs.readFileSync(httpsCertPath),
            },
            app,
        )
        .listen(HTTPS_PORT, '0.0.0.0', () => {
            console.log(`HTTPS server is running on https://<laptop-ip>:${HTTPS_PORT}`);
        });
}
