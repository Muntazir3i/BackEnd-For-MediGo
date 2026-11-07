/**
 * Controller for the digital expiry register.
 *
 * Every saved record belongs to one distributor and contains the medicine
 * batches that are expired or approaching expiry. All writes are transactional
 * so a partially saved record can never reach the register.
 */
import db from '../db/billPayment.js';
import { cleanDisplay } from '../utils/text.js';
import { notFoundError, validationError } from '../utils/httpError.js';

const statements = {
  insertRecord: db.prepare(`
    INSERT INTO expiry_records (
      date, supplierName, supplierDrugLn, supplierContact, type, totalQuantity, totalMrp
    )
    VALUES (
      @date, @supplierName, @supplierDrugLn, @supplierContact, @type, @totalQuantity, @totalMrp
    )
  `),
  insertItem: db.prepare(`
    INSERT INTO expiry_items (expiryRecordId, name, batchNumber, expiryDate, quantity, mrp)
    VALUES (@expiryRecordId, @name, @batchNumber, @expiryDate, @quantity, @mrp)
  `),
  itemsForRecord: db.prepare(`
    SELECT *
    FROM expiry_items
    WHERE expiryRecordId = ?
    ORDER BY date(expiryDate) ASC, name COLLATE NOCASE ASC, id ASC
  `),
  allRecords: db.prepare(`
    SELECT *
    FROM expiry_records
    ORDER BY date DESC, id DESC
  `),
  recordsBySupplier: db.prepare(`
    SELECT *
    FROM expiry_records
    WHERE supplierName = ?
    ORDER BY date DESC, id DESC
  `),
  recordById: db.prepare(`
    SELECT *
    FROM expiry_records
    WHERE id = ?
  `),
  deleteRecord: db.prepare(`
    DELETE FROM expiry_records
    WHERE id = ?
  `)
};

function todayIsoDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isValidIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return !Number.isNaN(new Date(`${value}T00:00:00`).getTime());
}

function mapItem(row) {
  return {
    ...row,
    // `stock` keeps the existing ledger/detail UI compatible.
    stock: row.quantity
  };
}

function mapRecord(row) {
  return {
    ...row,
    products: statements.itemsForRecord.all(row.id).map(mapItem)
  };
}

function normalizeItems(rawItems = []) {
  const items = [];

  rawItems.forEach((item, index) => {
    const lineNumber = index + 1;
    const name = cleanDisplay(item?.name);
    const batchNumber = cleanDisplay(item?.batchNumber);
    const expiryDate = cleanDisplay(item?.expiryDate);
    const quantity = Number(item?.quantity ?? item?.stock);
    const mrp = Number(item?.mrp);

    const isBlank = !name && !batchNumber && !expiryDate && !quantity && !mrp;
    if (isBlank) return;

    if (!name) throw validationError(`Medicine name is required for line ${lineNumber}.`);
    if (!batchNumber) throw validationError(`Batch number is required for line ${lineNumber}.`);
    if (!isValidIsoDate(expiryDate)) {
      throw validationError(`A valid expiry date is required for line ${lineNumber}.`);
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw validationError(`Quantity must be greater than zero for line ${lineNumber}.`);
    }
    if (!Number.isFinite(mrp) || mrp <= 0) {
      throw validationError(`MRP must be greater than zero for line ${lineNumber}.`);
    }

    items.push({
      name,
      batchNumber,
      expiryDate,
      quantity,
      mrp
    });
  });

  return items;
}

/**
 * Save one distributor expiry record and all of its medicine lines.
 */
function addExpiryRecord(payload = {}) {
  const supplierName = cleanDisplay(payload.supplierName);
  if (!supplierName) {
    throw validationError('Distributor name is required.');
  }

  const date = cleanDisplay(payload.date) || todayIsoDate();
  if (!isValidIsoDate(date)) {
    throw validationError('A valid record date is required.');
  }

  const items = normalizeItems(
    Array.isArray(payload.products)
      ? payload.products
      : Array.isArray(payload.items)
        ? payload.items
        : []
  );

  if (items.length === 0) {
    throw validationError('Add at least one medicine with a batch number, expiry date, quantity and MRP.');
  }

  const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
  const totalMrp = items.reduce((sum, item) => sum + item.quantity * item.mrp, 0);

  const save = db.transaction(() => {
    const result = statements.insertRecord.run({
      date,
      supplierName,
      supplierDrugLn: cleanDisplay(payload.supplierDrugLn) || null,
      supplierContact: cleanDisplay(payload.supplierContact) || null,
      type: 'EXPIRY',
      totalQuantity,
      totalMrp
    });

    const expiryRecordId = Number(result.lastInsertRowid);

    for (const item of items) {
      statements.insertItem.run({
        expiryRecordId,
        ...item
      });
    }

    return expiryRecordId;
  });

  const expiryRecordId = save();

  return {
    message: 'Expiry record saved successfully',
    expiryRecordId,
    record: mapRecord(statements.recordById.get(expiryRecordId))
  };
}

/** All expiry records, newest first, with their medicine lines. */
function getAllExpiryRecords() {
  return statements.allRecords.all().map(mapRecord);
}

/** Expiry records for one distributor, newest first. */
function findExpiryRecordsBySupplier(supplierName = '') {
  const name = cleanDisplay(supplierName);
  if (!name) return [];
  return statements.recordsBySupplier.all(name).map(mapRecord);
}

/** Delete an expiry record and its lines (items cascade). */
function deleteExpiryRecord(id) {
  const recordId = Number(id);
  if (!Number.isSafeInteger(recordId) || recordId <= 0) {
    throw validationError('Invalid expiry record id.');
  }

  const result = statements.deleteRecord.run(recordId);
  if (result.changes === 0) throw notFoundError('Expiry record not found');

  return { deleted: true, expiryRecordId: recordId };
}

export {
  addExpiryRecord,
  getAllExpiryRecords,
  findExpiryRecordsBySupplier,
  deleteExpiryRecord
};
