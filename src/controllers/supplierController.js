import db from "../db/db.js";

// 1. Pre-compile statements for better performance
// This avoids parsing the SQL string on every function call.
const statements = {
  addSupplier: db.prepare(`
    INSERT INTO suppliers (supplierName, phoneNumber, drugLn, supplierBalance)
    VALUES (@supplierName, @phoneNumber, @drugLn, @supplierBalance)
  `),
  getAllSuppliers: db.prepare(`
    SELECT * FROM suppliers
  `)
};

export function addSupplier({ supplierName, phoneNumber, drugLn, supplierBalance }) {
  // 2. Use named parameters with fallbacks to avoid crashes
  const info = statements.addSupplier.run({
    supplierName: supplierName || null,
    phoneNumber: phoneNumber || null,
    drugLn: drugLn || null,
    supplierBalance: supplierBalance || 0
  });

  return info.lastInsertRowid;
}

// Function to fetch all suppliers
export function getAllSuppliers() {
  return statements.getAllSuppliers.all();
}
