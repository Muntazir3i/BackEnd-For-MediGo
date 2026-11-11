/**
 * Sales invoice service.
 *
 * Sales line items are immutable snapshots. Stock is deducted inside an
 * IMMEDIATE transaction with a conditional UPDATE, so two tills cannot sell
 * the same last unit and stock can never go negative.
 */
import db from '../db/billPayment.js';
import { conflictError, notFoundError, validationError } from '../utils/httpError.js';
import {
  applyStockMovement,
  cleanDisplay,
  fetchInventoryById,
  round2,
  toNumber
} from '../services/inventoryService.js';

const round4 = (value) => Math.round((Number(value) + Number.EPSILON) * 10000) / 10000;

const statements = {
  invoiceById: db.prepare('SELECT * FROM invoices WHERE id = ?'),  invoiceByNumber: db.prepare('SELECT * FROM invoices WHERE invoiceNumber = ?'),
  invoiceByIdempotency: db.prepare('SELECT * FROM invoices WHERE idempotencyKey = ?'),
  itemsByInvoice: db.prepare(`
    SELECT ii.*, inv.quantity AS liveStock, p.drugSchedule AS liveDrugSchedule
    FROM invoice_items ii
    LEFT JOIN inventory_items inv ON inv.id = ii.inventoryItemId
    LEFT JOIN products p ON p.id = ii.productId
    WHERE ii.invoiceId = ?
    ORDER BY ii.id ASC
  `),
  updateInvoice: db.prepare(`
    UPDATE invoices
    SET customerName = @customerName,
        customerPhone = @customerPhone,
        customerAddress = @customerAddress,
        subtotal = @subtotal,
        totalDiscount = @totalDiscount,
        totalGst = @totalGst,
        total = @total,
        status = @status,
        prescriptionJson = @prescriptionJson,
        prescriberName = @prescriberName,
        prescriptionReference = @prescriptionReference,
        prescriptionVerified = @prescriptionVerified
    WHERE id = @id
  `),
  deleteInvoiceItems: db.prepare('DELETE FROM invoice_items WHERE invoiceId = ?'),
  insertInvoice: db.prepare(`
    INSERT INTO invoices (
      invoiceNumber, customerName, customerPhone, customerAddress, subtotal,
      totalDiscount, totalGst, total, status, stockDeducted, legacyRecord,
      prescriptionJson, prescriberName, prescriptionReference, prescriptionVerified,
      idempotencyKey, createdAt
    ) VALUES (
      @invoiceNumber, @customerName, @customerPhone, @customerAddress, @subtotal,
      @totalDiscount, @totalGst, @total, @status, 1, 0,
      @prescriptionJson, @prescriberName, @prescriptionReference, @prescriptionVerified,
      @idempotencyKey, @createdAt
    )
  `),
  insertInvoiceItem: db.prepare(`
    INSERT INTO invoice_items (
      invoiceId, productId, inventoryItemId, nameSnapshot, batchNumberSnapshot,
      expiryDateSnapshot, saltSummarySnapshot, drugScheduleSnapshot, quantity,
      saleQuantity, saleUnit, unitsPerPack, unitPrice, mrpSnapshot, discountPercent,
      discountAmount, gstPercent, gstAmount, lineSubtotal, lineTotal, createdAt
    ) VALUES (
      @invoiceId, @productId, @inventoryItemId, @nameSnapshot, @batchNumberSnapshot,
      @expiryDateSnapshot, @saltSummarySnapshot, @drugScheduleSnapshot, @quantity,
      @saleQuantity, @saleUnit, @unitsPerPack, @unitPrice, @mrpSnapshot, @discountPercent,
      @discountAmount, @gstPercent, @gstAmount, @lineSubtotal, @lineTotal, @createdAt
    )
  `),
  voidInvoice: db.prepare(`
    UPDATE invoices
    SET status = 'voided', voidedAt = datetime('now')
    WHERE id = @id AND status <> 'voided'
  `)
};

function createInvoiceNumber() {
  return `INV-${Math.floor(100000 + Math.random() * 900000)}`;
}

function normalizeDate(value) {
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return new Date().toISOString();
}

function parsePrescription(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value;
}

function serializePrescription(value) {
  if (!value) return null;
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function mapInvoiceItem(item) {
  const saleQuantity = Number(item.saleQuantity ?? item.quantity) || 0;
  const saleUnit = item.saleUnit || 'PACK';
  const unitsPerPack = Number(item.unitsPerPack) || 1;
  const saleUnitPrice = saleQuantity > 0
    ? round2((Number(item.lineSubtotal) || 0) / saleQuantity)
    : Number(item.unitPrice) || 0;

  return {
    id: item.inventoryItemId ?? item.id,
    invoiceItemId: item.id,
    invoiceId: item.invoiceId,
    productId: item.productId,
    inventoryItemId: item.inventoryItemId,
    name: item.nameSnapshot,
    qty: saleQuantity,
    quantity: saleQuantity,
    stockQuantity: item.quantity,
    liveStock: item.liveStock === undefined || item.liveStock === null
      ? null
      : Number(item.liveStock),
    liveDrugSchedule: item.liveDrugSchedule || null,
    saleQuantity,
    saleUnit,
    unitsPerPack,
    mrp: item.mrpSnapshot ?? 0,
    price: saleUnitPrice,
    unitPrice: saleUnitPrice,
    packUnitPrice: item.unitPrice,
    saleUnitPrice,
    discount: item.discountPercent,
    discountAmount: item.discountAmount,
    gstPercentage: item.gstPercent,
    gstAmount: item.gstAmount,
    lineSubtotal: item.lineSubtotal,
    lineTotal: item.lineTotal,
    batchNumber: item.batchNumberSnapshot,
    expiryDate: item.expiryDateSnapshot,
    drugSchedule: item.drugScheduleSnapshot || null,
    saltSummary: item.saltSummarySnapshot,
    createdAt: item.createdAt
  };
}

function mapInvoice(header, itemRows) {
  const items = itemRows.map(mapInvoiceItem);

  return {
    id: header.id,
    invoiceNumber: header.invoiceNumber,
    customer: {
      name: header.customerName,
      phone: header.customerPhone ?? '',
      address: header.customerAddress ?? ''
    },
    customerName: header.customerName,
    customerPhone: header.customerPhone,
    customerAddress: header.customerAddress,
    subtotal: header.subtotal,
    totalDiscount: header.totalDiscount,
    totalGst: header.totalGst,
    total: header.total,
    status: header.status,
    stockDeducted: header.stockDeducted,
    legacyRecord: header.legacyRecord,
    date: header.createdAt,
    createdAt: header.createdAt,
    voidedAt: header.voidedAt,
    prescription: parsePrescription(header.prescriptionJson),
    prescriberName: header.prescriberName || '',
    prescriptionReference: header.prescriptionReference || '',
    prescriptionVerified: Number(header.prescriptionVerified) === 1,
    items,
    medicines: items
  };
}

function loadInvoiceById(id) {
  const header = statements.invoiceById.get(Number(id));
  if (!header) return null;
  return mapInvoice(header, statements.itemsByInvoice.all(header.id));
}

function normalizeInvoiceItems(payload) {
  const rawItems = Array.isArray(payload.items)
    ? payload.items
    : Array.isArray(payload.medicines)
      ? payload.medicines
      : [];

  if (rawItems.length === 0) {
    throw validationError('At least one medicine is required');
  }

  return rawItems.map((item) => {
    const inventoryItemId = Number(item.inventoryItemId ?? item.id);
    const saleQuantity = toNumber(item.qty ?? item.saleQuantity ?? item.quantity);
    const saleUnit = cleanDisplay(item.saleUnit);
    const unitsPerPack = toNumber(item.unitsPerPack);
    const unitPrice = toNumber(item.price ?? item.unitPrice ?? item.mrp);
    const discountPercent = toNumber(item.discount ?? item.discountPercent);
    const gstPercent = toNumber(item.gstPercent ?? item.gstPercentage);

    if (!Number.isSafeInteger(inventoryItemId) || inventoryItemId <= 0) {
      throw validationError('Every invoice line must reference an inventory item');
    }
    if (saleQuantity <= 0) {
      throw validationError('Every invoice line must have a quantity greater than 0');
    }
    if (unitsPerPack < 0) {
      throw validationError('Units per pack cannot be negative');
    }
    if (unitPrice < 0) {
      throw validationError('Invoice price cannot be negative');
    }
    if (discountPercent < 0 || discountPercent > 100) {
      throw validationError('Discount must be between 0 and 100');
    }

    return {
      inventoryItemId,
      saleQuantity,
      saleUnit,
      unitsPerPack,
      unitPrice,
      discountPercent,
      gstPercent
    };
  });
}

const PACK_SALE_PATTERN = /^(PACK|PACKS|STRIP|STRIPS|BOX|BOXES|BOTTLE|BOTTLES|PIECE|PIECES|UNIT|UNITS)$/;

/**
 * Read inventory snapshots and calculate every line total. `allowedInactiveIds`
 * lets an invoice edit keep lines whose batch was archived after the sale.
 */
function prepareInvoiceLines(lines, { allowedInactiveIds = new Set() } = {}) {
  const prepared = lines.map((line) => {
    const inventory = fetchInventoryById(line.inventoryItemId);

    if (!inventory) {
      throw notFoundError('One of the medicines is no longer in inventory');
    }

    const isInactive = !inventory.isActive || !inventory.productIsActive;
    if (isInactive && !allowedInactiveIds.has(inventory.inventoryItemId)) {
      throw conflictError(`${inventory.name} is no longer available for sale`);
    }

    const unitsPerPack = Math.max(
      1,
      Number(line.unitsPerPack) || Number(inventory.unitsPerPack) || 1
    );
    const saleUnit = (line.saleUnit || inventory.unitLabel || 'PACK').toUpperCase();
    const isPackSale = PACK_SALE_PATTERN.test(saleUnit);
    const packQuantity = round4(
      isPackSale ? line.saleQuantity : line.saleQuantity / unitsPerPack
    );

    if (packQuantity <= 0) {
      throw validationError(`${inventory.name} quantity must be greater than 0`);
    }

    if (inventory.stock < packQuantity) {
      throw conflictError(
        `${inventory.name} only has ${inventory.stock} pack(s) available. Refresh the bill and try again.`,
        { inventoryItemId: inventory.inventoryItemId, available: inventory.stock }
      );
    }

    const lineSubtotal = round2(line.unitPrice * packQuantity);
    const discountAmount = round2(lineSubtotal * (line.discountPercent / 100));
    const lineTotal = round2(lineSubtotal - discountAmount);

    return {
      line: {
        ...line,
        quantity: packQuantity,
        saleUnit,
        unitsPerPack,
        lineSubtotal,
        discountAmount,
        lineTotal
      },
      inventory
    };
  });

  const subtotal = round2(prepared.reduce((sum, entry) => sum + entry.line.lineSubtotal, 0));
  const totalDiscount = round2(prepared.reduce((sum, entry) => sum + entry.line.discountAmount, 0));
  const totalGst = round2(prepared.reduce((sum, entry) => {
    const taxable = entry.line.lineSubtotal - entry.line.discountAmount;
    return sum + taxable * (entry.line.gstPercent / 100);
  }, 0));
  const total = round2(subtotal - totalDiscount + totalGst);

  return { prepared, subtotal, totalDiscount, totalGst, total };
}

const SCHEDULE_LABELS = {
  H: 'Schedule H',
  H1: 'Schedule H1',
  X: 'Schedule X'
};

function normalizeDrugSchedule(value) {
  const text = cleanDisplay(value).toUpperCase();
  return ['H', 'H1', 'X'].includes(text) ? text : null;
}

function validatePrescriptionCompliance({
  prepared,
  prescriberName,
  prescriptionReference,
  prescriptionVerified,
  prescription
}) {
  const schedules = [
    ...new Set(
      prepared
        .map(({ inventory }) => normalizeDrugSchedule(inventory.drugSchedule))
        .filter(Boolean)
    )
  ];

  if (schedules.length === 0) return;

  const labels = schedules.map((schedule) => SCHEDULE_LABELS[schedule]).join(', ');

  if (!prescriberName) {
    throw validationError(`Prescriber name is required for ${labels} medicines`);
  }

  if (!prescriptionVerified) {
    throw validationError('Confirm that the prescription was verified before billing scheduled medicines');
  }

  if (schedules.includes('X') && !prescriptionReference) {
    throw validationError('Prescription reference is required for Schedule X medicines');
  }

  if (schedules.includes('H1') && !prescriptionReference && !prescription) {
    throw validationError(
      'Attach a prescription or enter a prescription reference for Schedule H1 medicines'
    );
  }
}

function insertInvoiceLines({
  invoiceId,
  invoiceNumber,
  prepared,
  createdAt,
  movementType = 'sale',
  movementNote = null
}) {
  for (const { line, inventory } of prepared) {
    applyStockMovement({
      inventoryItemId: inventory.inventoryItemId,
      delta: -line.quantity,
      type: movementType,
      referenceType: 'invoice',
      referenceId: invoiceId,
      note: movementNote || `Sale ${invoiceNumber}`
    });

    const gstAmount = round2(
      (line.lineSubtotal - line.discountAmount) * (line.gstPercent / 100)
    );

    statements.insertInvoiceItem.run({
      invoiceId,
      productId: inventory.productId,
      inventoryItemId: inventory.inventoryItemId,
      nameSnapshot: inventory.name,
      batchNumberSnapshot: inventory.batchNumber,
      expiryDateSnapshot: inventory.expiryDate,
      saltSummarySnapshot: inventory.saltSummary || null,
      drugScheduleSnapshot: normalizeDrugSchedule(inventory.drugSchedule),
      quantity: line.quantity,
      saleQuantity: line.saleQuantity,
      saleUnit: line.saleUnit,
      unitsPerPack: line.unitsPerPack,
      unitPrice: line.unitPrice,
      mrpSnapshot: inventory.mrp,
      discountPercent: line.discountPercent,
      discountAmount: line.discountAmount,
      gstPercent: line.gstPercent,
      gstAmount,
      lineSubtotal: line.lineSubtotal,
      lineTotal: round2(line.lineTotal + gstAmount),
      createdAt
    });
  }
}

export function createSaleInvoice(payload = {}) {
  const customer = payload.customer ?? {};
  const customerName = cleanDisplay(customer.name ?? payload.customerName);

  if (!customerName) {
    throw validationError('Customer name is required');
  }

  const invoiceNumber = cleanDisplay(payload.invoiceNumber) || createInvoiceNumber();
  const requestedStatus = cleanDisplay(payload.status).toLowerCase();
  const status = requestedStatus === 'pending' ? 'pending' : 'completed';
  const createdAt = normalizeDate(payload.date ?? payload.createdAt);
  const idempotencyKey = cleanDisplay(payload.idempotencyKey) || null;
  const prescriptionJson = serializePrescription(payload.prescription);
  const prescriberName = cleanDisplay(payload.prescriberName);
  const prescriptionReference = cleanDisplay(payload.prescriptionReference);
  const prescriptionVerified =
    payload.prescriptionVerified === true
    || payload.prescriptionVerified === 1
    || payload.prescriptionVerified === '1'
      ? 1
      : 0;

  const transaction = db.transaction(() => {
    if (idempotencyKey) {
      const existing = statements.invoiceByIdempotency.get(idempotencyKey);
      if (existing) return { invoice: loadInvoiceById(existing.id), duplicate: true };
    }

    const existingNumber = statements.invoiceByNumber.get(invoiceNumber);
    if (existingNumber) {
      return { invoice: loadInvoiceById(existingNumber.id), duplicate: true };
    }

    const lines = normalizeInvoiceItems(payload);

    // Read the snapshot data before stock changes so the historical line keeps
    // the values that were true at the moment of sale.
    const { prepared, subtotal, totalDiscount, totalGst, total } =
      prepareInvoiceLines(lines);

    validatePrescriptionCompliance({
      prepared,
      prescriberName,
      prescriptionReference,
      prescriptionVerified,
      prescription: payload.prescription
    });

    const result = statements.insertInvoice.run({
      invoiceNumber,
      customerName,
      customerPhone: cleanDisplay(customer.phone ?? payload.customerPhone) || null,
      customerAddress: cleanDisplay(customer.address ?? payload.customerAddress) || null,
      subtotal,
      totalDiscount,
      totalGst,
      total,
      status,
      prescriptionJson,
      prescriberName: prescriberName || null,
      prescriptionReference: prescriptionReference || null,
      prescriptionVerified,
      idempotencyKey,
      createdAt
    });

    const invoiceId = Number(result.lastInsertRowid);

    insertInvoiceLines({
      invoiceId,
      invoiceNumber,
      prepared,
      createdAt,
      movementType: 'sale',
      movementNote: `Sale ${invoiceNumber}`
    });

    return { invoice: loadInvoiceById(invoiceId), duplicate: false };
  });

  return transaction.immediate();
}

export function listInvoices({
  date = '',
  customer = '',
  invoice = '',
  q = '',
  medicine = '',
  from = '',
  to = '',
  limit = 500,
  includeVoided = false
} = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 500, 1), 1000);
  const dateFilter = date && String(date).trim() !== '' ? String(date).trim() : null;
  const customerFilter = customer && String(customer).trim() !== ''
    ? `%${String(customer).trim()}%`
    : null;
  const invoiceFilter = invoice && String(invoice).trim() !== ''
    ? `%${String(invoice).trim()}%`
    : null;
  const queryFilter = q && String(q).trim() !== ''
    ? `%${String(q).trim()}%`
    : null;
  const medicineFilter = medicine && String(medicine).trim() !== ''
    ? `%${String(medicine).trim()}%`
    : null;
  const fromFilter = from && String(from).trim() !== '' ? String(from).trim() : null;
  const toFilter = to && String(to).trim() !== '' ? String(to).trim() : null;

  const headers = db.prepare(`
    SELECT *
    FROM invoices
    WHERE (@date IS NULL OR substr(createdAt, 1, 10) = @date)
      AND (@from IS NULL OR substr(createdAt, 1, 10) >= @from)
      AND (@to IS NULL OR substr(createdAt, 1, 10) <= @to)
      AND (@customer IS NULL OR customerName LIKE @customer)
      AND (@invoice IS NULL OR invoiceNumber LIKE @invoice)
      AND (
        @q IS NULL
        OR invoiceNumber LIKE @q
        OR customerName LIKE @q
        OR customerPhone LIKE @q
        OR EXISTS (
          SELECT 1 FROM invoice_items ii
          WHERE ii.invoiceId = invoices.id
            AND (ii.nameSnapshot LIKE @q OR ii.batchNumberSnapshot LIKE @q)
        )
      )
      AND (
        @medicine IS NULL
        OR EXISTS (
          SELECT 1 FROM invoice_items ii
          WHERE ii.invoiceId = invoices.id
            AND (ii.nameSnapshot LIKE @medicine OR ii.batchNumberSnapshot LIKE @medicine)
        )
      )
      AND (@includeVoided = 1 OR status <> 'voided')
    ORDER BY createdAt DESC, id DESC
    LIMIT ${safeLimit}
  `).all({
    date: dateFilter,
    from: fromFilter,
    to: toFilter,
    customer: customerFilter,
    invoice: invoiceFilter,
    q: queryFilter,
    medicine: medicineFilter,
    includeVoided: includeVoided ? 1 : 0
  });

  if (headers.length === 0) return [];

  const itemStmt = db.prepare(`
    SELECT ii.*, inv.quantity AS liveStock, p.drugSchedule AS liveDrugSchedule
    FROM invoice_items ii
    LEFT JOIN inventory_items inv ON inv.id = ii.inventoryItemId
    LEFT JOIN products p ON p.id = ii.productId
    WHERE ii.invoiceId IN (SELECT value FROM json_each(?))
    ORDER BY ii.invoiceId, ii.id
  `);

  let items = [];
  try {
    items = itemStmt.all(JSON.stringify(headers.map((header) => header.id)));
  } catch {
    items = [];
  }

  if (items.length === 0) {
    const placeholders = headers.map(() => '?').join(', ');
    items = db.prepare(`
      SELECT ii.*, inv.quantity AS liveStock, p.drugSchedule AS liveDrugSchedule
      FROM invoice_items ii
      LEFT JOIN inventory_items inv ON inv.id = ii.inventoryItemId
      LEFT JOIN products p ON p.id = ii.productId
      WHERE ii.invoiceId IN (${placeholders})
      ORDER BY ii.invoiceId, ii.id
    `).all(...headers.map((header) => header.id));
  }

  const byInvoice = new Map();
  for (const item of items) {
    if (!byInvoice.has(item.invoiceId)) byInvoice.set(item.invoiceId, []);
    byInvoice.get(item.invoiceId).push(item);
  }

  return headers.map((header) => mapInvoice(header, byInvoice.get(header.id) ?? []));
}

export function getSaleInvoice(id) {
  return loadInvoiceById(id);
}

/**
 * Edit a finalized sale.
 *
 * The old lines are returned to stock first, then the edited lines are priced,
 * validated and deducted in the same transaction. If anything fails (for
 * example the edited quantity is no longer available), the whole edit rolls
 * back and the original invoice and stock are untouched.
 */
export function updateSaleInvoice(id, payload = {}) {
  const invoiceId = Number(id);

  if (!Number.isSafeInteger(invoiceId) || invoiceId <= 0) {
    throw validationError('Invalid invoice id');
  }

  const transaction = db.transaction(() => {
    const invoice = statements.invoiceById.get(invoiceId);

    if (!invoice) {
      throw notFoundError('Invoice not found');
    }
    if (invoice.status === 'voided') {
      throw conflictError('This invoice has been voided and cannot be edited.');
    }
    if (invoice.stockDeducted !== 1 || invoice.legacyRecord === 1) {
      throw conflictError('This legacy invoice cannot be edited because it never deducted stock.');
    }

    const existingItems = statements.itemsByInvoice.all(invoiceId);

    // Return the original quantities before validating the edited lines so the
    // invoice can reuse the stock it already took.
    for (const item of existingItems) {
      if (!item.inventoryItemId) continue;
      applyStockMovement({
        inventoryItemId: item.inventoryItemId,
        delta: item.quantity,
        type: 'sale_edit',
        referenceType: 'invoice',
        referenceId: invoiceId,
        note: `Invoice ${invoice.invoiceNumber} edited (restore)`
      });
    }

    const customer = payload.customer ?? {};
    const hasCustomerName =
      payload.customerName !== undefined || customer.name !== undefined;
    const customerName = hasCustomerName
      ? cleanDisplay(customer.name ?? payload.customerName)
      : invoice.customerName;

    if (!customerName) {
      throw validationError('Customer name is required');
    }

    const hasPhone = payload.customerPhone !== undefined || customer.phone !== undefined;
    const customerPhone = hasPhone
      ? cleanDisplay(customer.phone ?? payload.customerPhone) || null
      : invoice.customerPhone;

    const hasAddress =
      payload.customerAddress !== undefined || customer.address !== undefined;
    const customerAddress = hasAddress
      ? cleanDisplay(customer.address ?? payload.customerAddress) || null
      : invoice.customerAddress;

    const requestedStatus = cleanDisplay(payload.status).toLowerCase();
    const status =
      requestedStatus === 'pending'
        ? 'pending'
        : requestedStatus === 'completed'
          ? 'completed'
          : invoice.status;

    const prescriptionJson = Object.prototype.hasOwnProperty.call(payload, 'prescription')
      ? serializePrescription(payload.prescription)
      : invoice.prescriptionJson;

    const prescriberName = payload.prescriberName === undefined
      ? invoice.prescriberName || ''
      : cleanDisplay(payload.prescriberName);
    const prescriptionReference = payload.prescriptionReference === undefined
      ? invoice.prescriptionReference || ''
      : cleanDisplay(payload.prescriptionReference);
    const prescriptionVerified = payload.prescriptionVerified === undefined
      ? (Number(invoice.prescriptionVerified) === 1 ? 1 : 0)
      : (
        payload.prescriptionVerified === true
        || payload.prescriptionVerified === 1
        || payload.prescriptionVerified === '1'
          ? 1
          : 0
      );
    const prescriptionForValidation = Object.prototype.hasOwnProperty.call(payload, 'prescription')
      ? payload.prescription
      : parsePrescription(invoice.prescriptionJson);

    const lines = normalizeInvoiceItems(payload);
    const allowedInactiveIds = new Set(
      existingItems
        .map((item) => item.inventoryItemId)
        .filter((inventoryItemId) => Number.isSafeInteger(Number(inventoryItemId)))
    );

    const { prepared, subtotal, totalDiscount, totalGst, total } =
      prepareInvoiceLines(lines, { allowedInactiveIds });

    validatePrescriptionCompliance({
      prepared,
      prescriberName,
      prescriptionReference,
      prescriptionVerified,
      prescription: prescriptionForValidation
    });

    statements.updateInvoice.run({
      id: invoiceId,
      customerName,
      customerPhone,
      customerAddress,
      subtotal,
      totalDiscount,
      totalGst,
      total,
      status,
      prescriptionJson,
      prescriberName: prescriberName || null,
      prescriptionReference: prescriptionReference || null,
      prescriptionVerified
    });

    statements.deleteInvoiceItems.run(invoiceId);

    insertInvoiceLines({
      invoiceId,
      invoiceNumber: invoice.invoiceNumber,
      prepared,
      createdAt: new Date().toISOString(),
      movementType: 'sale_edit',
      movementNote: `Invoice ${invoice.invoiceNumber} edited`
    });

    return loadInvoiceById(invoiceId);
  });

  return transaction.immediate();
}

export function voidSaleInvoice(id) {
  const invoiceId = Number(id);

  if (!Number.isSafeInteger(invoiceId) || invoiceId <= 0) {
    throw validationError('Invalid invoice id');
  }

  const transaction = db.transaction(() => {
    const invoice = statements.invoiceById.get(invoiceId);

    if (!invoice) return { voided: false, invoice: null };
    if (invoice.status === 'voided') {
      throw conflictError('This invoice has already been voided.');
    }
    if (invoice.stockDeducted !== 1 || invoice.legacyRecord === 1) {
      throw conflictError('This legacy invoice cannot be voided because it never deducted stock.');
    }

    const items = statements.itemsByInvoice.all(invoiceId);

    for (const item of items) {
      if (!item.inventoryItemId) continue;
      applyStockMovement({
        inventoryItemId: item.inventoryItemId,
        delta: item.quantity,
        type: 'void',
        referenceType: 'invoice',
        referenceId: invoiceId,
        note: `Invoice ${invoice.invoiceNumber} voided`
      });
    }

    statements.voidInvoice.run({ id: invoiceId });

    return { voided: true, invoice: loadInvoiceById(invoiceId) };
  });

  return transaction.immediate();
}

/**
 * Delete a customer invoice from the active sales list.
 *
 * The row is retained as a voided record for audit, but each line's exact
 * inventory item and quantity is returned to stock before it disappears from
 * invoice searches. Legacy invoices never deducted stock, so they are removed
 * without a stock movement.
 */
export function deleteSaleInvoice(id) {
  const invoiceId = Number(id);

  if (!Number.isSafeInteger(invoiceId) || invoiceId <= 0) {
    throw validationError('Invalid invoice id');
  }

  const transaction = db.transaction(() => {
    const invoice = statements.invoiceById.get(invoiceId);

    if (!invoice) return { deleted: false, invoice: null };
    if (invoice.status === 'voided') {
      throw conflictError('This invoice has already been deleted.');
    }

    if (invoice.stockDeducted === 1) {
      const items = statements.itemsByInvoice.all(invoiceId);

      for (const item of items) {
        if (!item.inventoryItemId) continue;
        applyStockMovement({
          inventoryItemId: item.inventoryItemId,
          delta: item.quantity,
          type: 'void',
          referenceType: 'invoice',
          referenceId: invoiceId,
          note: `Invoice ${invoice.invoiceNumber} deleted`
        });
      }
    }

    statements.voidInvoice.run({ id: invoiceId });

    return { deleted: true, invoice: loadInvoiceById(invoiceId) };
  });

  return transaction.immediate();
}
