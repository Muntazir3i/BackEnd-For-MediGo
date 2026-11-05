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

const statements = {
  invoiceById: db.prepare('SELECT * FROM invoices WHERE id = ?'),
  invoiceByNumber: db.prepare('SELECT * FROM invoices WHERE invoiceNumber = ?'),
  invoiceByIdempotency: db.prepare('SELECT * FROM invoices WHERE idempotencyKey = ?'),
  itemsByInvoice: db.prepare(`
    SELECT * FROM invoice_items WHERE invoiceId = ? ORDER BY id ASC
  `),
  insertInvoice: db.prepare(`
    INSERT INTO invoices (
      invoiceNumber, customerName, customerPhone, customerAddress, subtotal,
      totalDiscount, totalGst, total, status, stockDeducted, legacyRecord,
      prescriptionJson, idempotencyKey, createdAt
    ) VALUES (
      @invoiceNumber, @customerName, @customerPhone, @customerAddress, @subtotal,
      @totalDiscount, @totalGst, @total, @status, 1, 0,
      @prescriptionJson, @idempotencyKey, @createdAt
    )
  `),
  insertInvoiceItem: db.prepare(`
    INSERT INTO invoice_items (
      invoiceId, productId, inventoryItemId, nameSnapshot, batchNumberSnapshot,
      expiryDateSnapshot, saltSummarySnapshot, quantity, unitPrice, mrpSnapshot,
      discountPercent, discountAmount, gstPercent, gstAmount, lineSubtotal,
      lineTotal, createdAt
    ) VALUES (
      @invoiceId, @productId, @inventoryItemId, @nameSnapshot, @batchNumberSnapshot,
      @expiryDateSnapshot, @saltSummarySnapshot, @quantity, @unitPrice, @mrpSnapshot,
      @discountPercent, @discountAmount, @gstPercent, @gstAmount, @lineSubtotal,
      @lineTotal, @createdAt
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
  return {
    id: item.inventoryItemId ?? item.id,
    invoiceItemId: item.id,
    invoiceId: item.invoiceId,
    productId: item.productId,
    inventoryItemId: item.inventoryItemId,
    name: item.nameSnapshot,
    qty: item.quantity,
    quantity: item.quantity,
    mrp: item.mrpSnapshot ?? 0,
    price: item.unitPrice,
    unitPrice: item.unitPrice,
    discount: item.discountPercent,
    discountAmount: item.discountAmount,
    gstPercentage: item.gstPercent,
    gstAmount: item.gstAmount,
    lineSubtotal: item.lineSubtotal,
    lineTotal: item.lineTotal,
    batchNumber: item.batchNumberSnapshot,
    expiryDate: item.expiryDateSnapshot,
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
    const quantity = toNumber(item.qty ?? item.quantity);
    const unitPrice = toNumber(item.price ?? item.unitPrice ?? item.mrp);
    const discountPercent = toNumber(item.discount ?? item.discountPercent);
    const gstPercent = toNumber(item.gstPercent ?? item.gstPercentage);

    if (!Number.isSafeInteger(inventoryItemId) || inventoryItemId <= 0) {
      throw validationError('Every invoice line must reference an inventory item');
    }
    if (quantity <= 0) {
      throw validationError('Every invoice line must have a quantity greater than 0');
    }
    if (unitPrice < 0) {
      throw validationError('Invoice price cannot be negative');
    }
    if (discountPercent < 0 || discountPercent > 100) {
      throw validationError('Discount must be between 0 and 100');
    }

    const lineSubtotal = round2(unitPrice * quantity);
    const discountAmount = round2(lineSubtotal * (discountPercent / 100));
    const lineTotal = round2(lineSubtotal - discountAmount);

    return {
      inventoryItemId,
      quantity,
      unitPrice,
      discountPercent,
      gstPercent,
      lineSubtotal,
      discountAmount,
      lineTotal
    };
  });
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
    const prepared = lines.map((line) => {
      const inventory = fetchInventoryById(line.inventoryItemId);

      if (!inventory) {
        throw notFoundError('One of the medicines is no longer in inventory');
      }

      if (!inventory.isActive || !inventory.productIsActive) {
        throw conflictError(`${inventory.name} is no longer available for sale`);
      }

      if (inventory.stock < line.quantity) {
        throw conflictError(
          `${inventory.name} only has ${inventory.stock} unit(s) available. Refresh the bill and try again.`,
          { inventoryItemId: inventory.inventoryItemId, available: inventory.stock }
        );
      }

      return { line, inventory };
    });

    const subtotal = round2(prepared.reduce((sum, entry) => sum + entry.line.lineSubtotal, 0));
    const totalDiscount = round2(prepared.reduce((sum, entry) => sum + entry.line.discountAmount, 0));
    const totalGst = round2(prepared.reduce((sum, entry) => {
      const taxable = entry.line.lineSubtotal - entry.line.discountAmount;
      return sum + taxable * (entry.line.gstPercent / 100);
    }, 0));
    const total = round2(subtotal - totalDiscount + totalGst);

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
      idempotencyKey,
      createdAt
    });

    const invoiceId = Number(result.lastInsertRowid);

    for (const { line, inventory } of prepared) {
      applyStockMovement({
        inventoryItemId: inventory.inventoryItemId,
        delta: -line.quantity,
        type: 'sale',
        referenceType: 'invoice',
        referenceId: invoiceId,
        note: `Sale ${invoiceNumber}`
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
        quantity: line.quantity,
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

    return { invoice: loadInvoiceById(invoiceId), duplicate: false };
  });

  return transaction.immediate();
}

export function listInvoices({ date = '', customer = '', invoice = '', limit = 500 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 500, 1), 1000);
  const dateFilter = date && String(date).trim() !== '' ? String(date).trim() : null;
  const customerFilter = customer && String(customer).trim() !== ''
    ? `%${String(customer).trim()}%`
    : null;
  const invoiceFilter = invoice && String(invoice).trim() !== ''
    ? `%${String(invoice).trim()}%`
    : null;

  const headers = db.prepare(`
    SELECT *
    FROM invoices
    WHERE (@date IS NULL OR substr(createdAt, 1, 10) = @date)
      AND (@customer IS NULL OR customerName LIKE @customer)
      AND (@invoice IS NULL OR invoiceNumber LIKE @invoice)
    ORDER BY createdAt DESC, id DESC
    LIMIT ${safeLimit}
  `).all({
    date: dateFilter,
    customer: customerFilter,
    invoice: invoiceFilter
  });

  if (headers.length === 0) return [];

  const itemStmt = db.prepare(`
    SELECT * FROM invoice_items
    WHERE invoiceId IN (SELECT value FROM json_each(?))
    ORDER BY invoiceId, id
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
      SELECT * FROM invoice_items
      WHERE invoiceId IN (${placeholders})
      ORDER BY invoiceId, id
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
