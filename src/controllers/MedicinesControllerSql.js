/**
 * Controller for managing medicine-related database operations using SQLite.
 *
 * Provides functionality to fetch the newest medicines (products) from the
 * database. Only 100 rows are returned so the inventory screen loads quickly.
 */
import db from "../db/billPayment.js";

export const MEDICINE_PAGE_SIZE = 100;

// 1. Pre-compile statements for better performance
// This avoids parsing the SQL string on every function call.
const statements = {
  fetchAllMedicines: db.prepare(`
      SELECT * FROM bill_products
      ORDER BY id DESC
      LIMIT ${MEDICINE_PAGE_SIZE}
    `)
};

export function fetchAllMedicines() {
  return statements.fetchAllMedicines.all(); // Fetches the newest 100 rows from bill_products
}
