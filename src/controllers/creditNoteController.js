/**
 * CRUD controller for distributor credit notes.
 *
 * Credit notes use the same line-item fields and calculations as purchase
 * bills. Header totals are always calculated from the item lines.
 */
import db from '../db/billPayment.js';
import { cleanDisplay } from '../utils/text.js';
import { notFoundError, validationError } from '../utils/httpError.js';

const statements = {
  insertHeader: db.prepare(`
    INSERT INTO credit_notes (
      creditNoteNumber, date, supplierName, supplierDrugLn, supplierContact,
      totalAmount, totalDiscount, totalGst, total
    ) VALUES (
      @creditNoteNumber, @date, @supplierName, @supplierDrugLn, @supplierContact,
      @totalAmount, @totalDiscount, @totalGst, @total
    )
  `),
  updateHeader: db.prepare(`
    UPDATE credit_notes SET
      creditNoteNumber = @creditNoteNumber,
      date = @date,
      supplierName = @supplierName,
      supplierDrugLn = @supplierDrugLn,
      supplierContact = @supplierContact,
      totalAmount = @totalAmount,
      totalDiscount = @totalDiscount,
      totalGst = @totalGst,
      total = @total,
      updatedAt = datetime('now')
    WHERE id = @id
  `),
  insertItem: db.prepare(`
    INSERT INTO credit_note_items (
      creditNoteId, name, category, batchNumber, expiryDate,
      quantity, unitPrice, mrp, discount, gstPercentage, lineTotal
    ) VALUES (
      @creditNoteId, @name, @category, @batchNumber, @expiryDate,
      @quantity, @unitPrice, @mrp, @discount, @gstPercentage, @lineTotal
    )
  `),
  itemsForNote: db.prepare(`
    SELECT *
    FROM credit_note_items
    WHERE creditNoteId = ?
    ORDER BY id ASC
  `),
  deleteItems: db.prepare('DELETE FROM credit_note_items WHERE creditNoteId = ?'),
  list: db.prepare(`
    SELECT *
    FROM credit_notes
    WHERE (
      @search IS NULL
      OR creditNoteNumber LIKE @search
      OR supplierName LIKE @search
      OR EXISTS (
        SELECT 1 FROM credit_note_items i
        WHERE i.creditNoteId = credit_notes.id
          AND (i.name LIKE @search OR i.batchNumber LIKE @search)
      )
    )
      AND (@supplierName IS NULL OR supplierName = @supplierName)
      AND (@from IS NULL OR date >= @from)
      AND (@to IS NULL OR date <= @to)
    ORDER BY date DESC, id DESC
  `),
  byId: db.prepare('SELECT * FROM credit_notes WHERE id = ?'),
  remove: db.prepare('DELETE FROM credit_notes WHERE id = ?')
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

const round2 = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

function mapRecord(row) {
  if (!row) return null;
  const items = statements.itemsForNote.all(row.id);
  const totalQuantity = items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);

  return {
    ...row,
    creditAmount: row.total,
    itemCount: items.length,
    totalQuantity,
    items
  };
}

function normalizeItems(rawItems = []) {
  const items = [];

  rawItems.forEach((item, index) => {
    const lineNumber = index + 1;
    const name = cleanDisplay(item?.name);
    const category = cleanDisplay(item?.category);
    const batchNumber = cleanDisplay(item?.batchNumber);
    const expiryDate = cleanDisplay(item?.expiryDate);
    const quantity = Number(item?.quantity ?? item?.stock);
    const unitPrice = Number(item?.unitPrice);
    const mrp = Number(item?.mrp);
    const discount = Number(item?.discount ?? 0);
    const gstPercentage = Number(item?.gstPercentage ?? item?.gst ?? 0);

    const isBlank =
      !name &&
      !batchNumber &&
      !expiryDate &&
      !quantity &&
      !unitPrice &&
      !mrp;

    if (isBlank) return;

    if (!name) throw validationError(`Medicine name is required for line ${lineNumber}.`);
    if (!batchNumber) throw validationError(`Batch number is required for line ${lineNumber}.`);
    if (!isValidIsoDate(expiryDate)) {
      throw validationError(`A valid expiry date is required for line ${lineNumber}.`);
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw validationError(`Quantity must be greater than zero for line ${lineNumber}.`);
    }
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
      throw validationError(`Rate must be greater than zero for line ${lineNumber}.`);
    }
    if (!Number.isFinite(mrp) || mrp <= 0) {
      throw validationError(`MRP must be greater than zero for line ${lineNumber}.`);
    }
    if (!Number.isFinite(discount) || discount < 0 || discount > 100) {
      throw validationError(`Discount must be between 0 and 100 for line ${lineNumber}.`);
    }
    if (!Number.isFinite(gstPercentage) || gstPercentage < 0) {
      throw validationError(`GST must be zero or greater for line ${lineNumber}.`);
    }

    const lineSubtotal = round2(quantity * unitPrice);
    const lineDiscount = round2(lineSubtotal * (discount / 100));
    const lineGst = round2((lineSubtotal - lineDiscount) * (gstPercentage / 100));
    const lineTotal = round2(lineSubtotal - lineDiscount + lineGst);

    items.push({
      name,
      category: category || null,
      batchNumber,
      expiryDate,
      quantity,
      unitPrice: round2(unitPrice),
      mrp: round2(mrp),
      discount,
      gstPercentage,
      lineTotal
    });
  });

  return items;
}

function normalizePayload(payload = {}) {
  const creditNoteNumber = cleanDisplay(payload.creditNoteNumber);
  const date = cleanDisplay(payload.date) || todayIsoDate();
  const supplierName = cleanDisplay(payload.supplierName);
  const supplierDrugLn = cleanDisplay(payload.supplierDrugLn);
  const supplierContact = cleanDisplay(payload.supplierContact);
  const items = normalizeItems(
    Array.isArray(payload.items)
      ? payload.items
      : Array.isArray(payload.products)
        ? payload.products
        : []
  );

  if (!creditNoteNumber) throw validationError('Credit note number is required.');
  if (!isValidIsoDate(date)) throw validationError('A valid credit note date is required.');
  if (!supplierName) throw validationError('Distributor name is required.');
  if (items.length === 0) {
    throw validationError('Add at least one medicine with a batch, expiry date, quantity, rate and MRP.');
  }

  const totalAmount = round2(items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0));
  const totalDiscount = round2(items.reduce((sum, item) => {
    const lineSubtotal = item.quantity * item.unitPrice;
    return sum + lineSubtotal * (item.discount / 100);
  }, 0));
  const totalGst = round2(items.reduce((sum, item) => {
    const lineSubtotal = item.quantity * item.unitPrice;
    const lineDiscount = lineSubtotal * (item.discount / 100);
    return sum + (lineSubtotal - lineDiscount) * (item.gstPercentage / 100);
  }, 0));
  const total = round2(totalAmount - totalDiscount + totalGst);

  return {
    header: {
      creditNoteNumber,
      date,
      supplierName,
      supplierDrugLn: supplierDrugLn || null,
      supplierContact: supplierContact || null,
      totalAmount,
      totalDiscount,
      totalGst,
      total
    },
    items
  };
}

function insertItems(creditNoteId, items) {
  for (const item of items) {
    statements.insertItem.run({ creditNoteId, ...item });
  }
}

function addCreditNote(payload = {}) {
  const { header, items } = normalizePayload(payload);

  const save = db.transaction(() => {
    const result = statements.insertHeader.run(header);
    const creditNoteId = Number(result.lastInsertRowid);
    insertItems(creditNoteId, items);
    return creditNoteId;
  });

  const creditNoteId = save();

  return {
    message: 'Credit note saved successfully',
    creditNote: mapRecord(statements.byId.get(creditNoteId))
  };
}

function getCreditNotes({ search = '', from = '', to = '', supplierName = '' } = {}) {
  const term = cleanDisplay(search);
  const fromDate = cleanDisplay(from);
  const toDate = cleanDisplay(to);
  const supplier = cleanDisplay(supplierName);

  return statements.list.all({
    search: term ? `%${term}%` : null,
    supplierName: supplier || null,
    from: fromDate || null,
    to: toDate || null
  }).map(mapRecord);
}

function getCreditNoteById(id) {
  const recordId = Number(id);
  if (!Number.isSafeInteger(recordId) || recordId <= 0) {
    throw validationError('Invalid credit note id.');
  }

  const creditNote = mapRecord(statements.byId.get(recordId));
  if (!creditNote) throw notFoundError('Credit note not found');
  return creditNote;
}

function updateCreditNote(id, payload = {}) {
  const recordId = Number(id);
  if (!Number.isSafeInteger(recordId) || recordId <= 0) {
    throw validationError('Invalid credit note id.');
  }
  if (!statements.byId.get(recordId)) throw notFoundError('Credit note not found');

  const { header, items } = normalizePayload(payload);

  const update = db.transaction(() => {
    statements.updateHeader.run({ id: recordId, ...header });
    statements.deleteItems.run(recordId);
    insertItems(recordId, items);
  });

  update();

  return {
    message: 'Credit note updated successfully',
    creditNote: mapRecord(statements.byId.get(recordId))
  };
}

function deleteCreditNote(id) {
  const recordId = Number(id);
  if (!Number.isSafeInteger(recordId) || recordId <= 0) {
    throw validationError('Invalid credit note id.');
  }

  const result = statements.remove.run(recordId);
  if (result.changes === 0) throw notFoundError('Credit note not found');

  return { deleted: true, creditNoteId: recordId };
}

export {
  addCreditNote,
  getCreditNotes,
  getCreditNoteById,
  updateCreditNote,
  deleteCreditNote
};
