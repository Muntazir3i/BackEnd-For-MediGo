import Database from 'better-sqlite3';

const databasePath = process.env.DB_PATH || 'billsNpayment.db';
const db = new Database(databasePath); // Will create if doesn't exist

// WAL keeps reads responsive while a sale/purchase transaction is writing.
// busy_timeout lets a second writer wait briefly instead of failing with
// SQLITE_BUSY when two tills submit at the same moment.
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');
db.pragma('foreign_keys = ON');

// Function to fetch all bills and payments
export function fetchAllData() {
    const billsQuery = db.prepare(`
        SELECT * FROM purchase_bills WHERE status <> 'void'
    `);
    const paymentsQuery = db.prepare('SELECT * FROM payments');

    const bills = billsQuery.all();
    const payments = paymentsQuery.all();

    return { bills, payments };
}

export function fetchDataBySupplier(supplierName) {
    const billsQuery = db.prepare(`
        SELECT * FROM purchase_bills WHERE supplierName = ? AND status <> 'void'
    `);
    const paymentsQuery = db.prepare('SELECT * FROM payments WHERE supplierName = ?');

    const bills = billsQuery.all(supplierName);
    const payments = paymentsQuery.all(supplierName);

    return { bills, payments };
}

export default db;
