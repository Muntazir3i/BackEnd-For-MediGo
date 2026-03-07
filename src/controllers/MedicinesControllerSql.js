import db from "../db/billPayment.js";

// 1. Pre-compile statements for better performance
// This avoids parsing the SQL string on every function call.
const statements = {
  fetchAllMedicines: db.prepare(`
      SELECT * FROM bill_products
    `)
};

export function fetchAllMedicines() {
  return statements.fetchAllMedicines.all(); // Fetches all rows from the bill_products table
}