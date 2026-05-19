/**
 * Controller for managing medicine-related database operations using SQLite.
 * 
 * Provides functionality to fetch all medicines (products) from the database.
 */
import db from "../db/billPayment.js";

// 1. Pre-compile statements for better performance
// This avoids parsing the SQL string on every function call.
const statements = {
  fetchAllMedicines: db.prepare(`
      SELECT * FROM bill_products
      LIMIT 100
    `)
};

export function fetchAllMedicines() {
  return statements.fetchAllMedicines.all(); // Fetches all rows from the bill_products table
}