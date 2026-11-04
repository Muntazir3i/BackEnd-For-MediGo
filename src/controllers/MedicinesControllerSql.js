/**
 * Controller for managing medicine-related database operations using SQLite.
 *
 * Provides functionality to fetch the newest medicines (products) from the
 * database. Only 100 rows are returned so the inventory screen loads quickly.
 * Edit and delete operate on the same `bill_products` rows the inventory reads.
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
    `),
  getMedicine: db.prepare(`
      SELECT * FROM bill_products
      WHERE id = ?
    `),
  updateMedicine: db.prepare(`
      UPDATE bill_products
      SET name = @name,
          batchNumber = @batchNumber,
          expiryDate = @expiryDate,
          stock = @stock,
          unitPrice = @unitPrice,
          mrp = @mrp,
          discount = @discount,
          gstPercentage = @gstPercentage,
          supplier = @supplier,
          category = @category
      WHERE id = @id
    `),
  deleteMedicine: db.prepare(`
      DELETE FROM bill_products
      WHERE id = ?
    `)
};

export function fetchAllMedicines() {
  return statements.fetchAllMedicines.all(); // Fetches the newest 100 rows from bill_products
}

const toNumber = (value, fallback = 0) => {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toText = (value, fallback = '') => {
  if (value === null || value === undefined) return fallback;
  return String(value).trim();
};

/**
 * Update a single medicine row. Only fields present in `data` are changed, so
 * callers can safely send partial updates.
 */
export function updateMedicineById(id, data = {}) {
  const medicineId = Number(id);

  if (!Number.isSafeInteger(medicineId) || medicineId <= 0) {
    throw new Error('Invalid medicine id');
  }

  const existing = statements.getMedicine.get(medicineId);

  if (!existing) {
    return { updated: false, medicine: null };
  }

  const merged = {
    id: medicineId,
    name: data.name !== undefined ? toText(data.name, existing.name) : existing.name,
    batchNumber:
      data.batchNumber !== undefined ? toText(data.batchNumber, existing.batchNumber) : existing.batchNumber,
    expiryDate:
      data.expiryDate !== undefined ? toText(data.expiryDate, existing.expiryDate) : existing.expiryDate,
    stock: data.stock !== undefined ? toNumber(data.stock, existing.stock) : existing.stock,
    unitPrice: data.unitPrice !== undefined ? toNumber(data.unitPrice, existing.unitPrice) : existing.unitPrice,
    mrp: data.mrp !== undefined ? toNumber(data.mrp, existing.mrp) : existing.mrp,
    discount: data.discount !== undefined ? toNumber(data.discount, existing.discount) : existing.discount,
    gstPercentage:
      data.gstPercentage !== undefined ? toNumber(data.gstPercentage, existing.gstPercentage) : existing.gstPercentage,
    supplier: data.supplier !== undefined ? toText(data.supplier, existing.supplier) : existing.supplier,
    category: data.category !== undefined ? toText(data.category, existing.category) : existing.category
  };

  if (!merged.name) {
    throw new Error('Medicine name is required');
  }

  statements.updateMedicine.run(merged);

  return { updated: true, medicine: statements.getMedicine.get(medicineId) };
}

export function deleteMedicineById(id) {
  const medicineId = Number(id);

  if (!Number.isSafeInteger(medicineId) || medicineId <= 0) {
    throw new Error('Invalid medicine id');
  }

  const result = statements.deleteMedicine.run(medicineId);

  return { deleted: result.changes > 0 };
}
