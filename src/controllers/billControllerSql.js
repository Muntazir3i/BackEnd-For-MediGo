/**
 * Purchase-bill controller.
 *
 * Purchase history now lives in purchase_bills / purchase_items. Live stock
 * lives in inventory_items, so editing a historical bill applies an explicit
 * quantity delta and writes a stock movement instead of rewriting stock rows.
 */
import db from '../db/billPayment.js';
import { conflictError, notFoundError, validationError } from '../utils/httpError.js';
import {
  applyStockMovement,
  cleanDisplay,
  formatSaltSummary,
  getSaltsForProductIds,
  resolveInventoryItem,
  resolveProduct,
  round2,
  toNumber
} from '../services/inventoryService.js';
import { replaceProductSalts } from '../services/saltService.js';

export const DEFAULT_BILL_PAGE_SIZE = 5;

const statements = {
  insertBill: db.prepare(`
    INSERT INTO purchase_bills (
      id, invoice, date, supplierName, supplierDrugLn, supplierContact,
      totalAmount, totalGst, totalDiscount, total, type, status, createdAt, updatedAt
    ) VALUES (
      @id, @invoice, @date, @supplierName, @supplierDrugLn, @supplierContact,
      @totalAmount, @totalGst, @totalDiscount, @total, @type, 'posted',
      datetime('now'), datetime('now')
    )
  `),
  getBill: db.prepare('SELECT * FROM purchase_bills WHERE id = ?'),
  productsForBill: db.prepare(`
    SELECT
      pi.*,
      i.quantity AS availableStock,
      i.sellingPrice AS availableSellingPrice
    FROM purchase_items pi
    LEFT JOIN inventory_items i ON i.id = pi.inventoryItemId
    WHERE pi.purchaseBillId = ?
    ORDER BY pi.id ASC
  `),
  insertPurchaseItem: db.prepare(`
    INSERT INTO purchase_items (
      purchaseBillId, productId, inventoryItemId, nameSnapshot,
      batchNumberSnapshot, expiryDateSnapshot, quantity, free, unitPrice, mrp,
      discount, gstPercentage, supplierSnapshot, categorySnapshot, createdAt
    ) VALUES (
      @purchaseBillId, @productId, @inventoryItemId, @nameSnapshot,
      @batchNumberSnapshot, @expiryDateSnapshot, @quantity, @free, @unitPrice, @mrp,
      @discount, @gstPercentage, @supplierSnapshot, @categorySnapshot, datetime('now')
    )
  `),
  updatePurchaseItem: db.prepare(`
    UPDATE purchase_items
    SET productId = @productId,
        inventoryItemId = @inventoryItemId,
        nameSnapshot = @nameSnapshot,
        batchNumberSnapshot = @batchNumberSnapshot,
        expiryDateSnapshot = @expiryDateSnapshot,
        quantity = @quantity,
        free = @free,
        unitPrice = @unitPrice,
        mrp = @mrp,
        discount = @discount,
        gstPercentage = @gstPercentage,
        categorySnapshot = @categorySnapshot
    WHERE id = @id AND purchaseBillId = @purchaseBillId
  `),
  countBills: db.prepare(`
    SELECT COUNT(*) AS total
    FROM purchase_bills
    WHERE status <> 'void'
      AND (@supplier IS NULL OR supplierName = @supplier)
      AND (@supplierSearch IS NULL OR supplierName LIKE @supplierSearch)
      AND (@date IS NULL OR date LIKE @date)
      AND (@invoice IS NULL OR invoice LIKE @invoice)
  `),
  pageBills: db.prepare(`
    SELECT *
    FROM purchase_bills
    WHERE status <> 'void'
      AND (@supplier IS NULL OR supplierName = @supplier)
      AND (@supplierSearch IS NULL OR supplierName LIKE @supplierSearch)
      AND (@date IS NULL OR date LIKE @date)
      AND (@invoice IS NULL OR invoice LIKE @invoice)
    ORDER BY date DESC, id DESC
    LIMIT @limit OFFSET @offset
  `),
  supplierSummaries: db.prepare(`
    SELECT
      supplierName,
      MAX(supplierDrugLn) AS supplierDrugLn,
      COUNT(*) AS billCount,
      COALESCE(SUM(total), 0) AS total
    FROM purchase_bills
    WHERE status <> 'void'
      AND supplierName IS NOT NULL
      AND (@search IS NULL OR supplierName LIKE @search)
      AND (@date IS NULL OR date LIKE @date)
      AND (@invoice IS NULL OR invoice LIKE @invoice)
    GROUP BY supplierName
    ORDER BY supplierName COLLATE NOCASE ASC
  `),
  updateBill: db.prepare(`
    UPDATE purchase_bills
    SET invoice = @invoice,
        date = @date,
        supplierName = @supplierName,
        supplierDrugLn = @supplierDrugLn,
        supplierContact = @supplierContact,
        totalAmount = @totalAmount,
        totalGst = @totalGst,
        totalDiscount = @totalDiscount,
        total = @total,
        updatedAt = datetime('now')
    WHERE id = @id
  `),
  voidBill: db.prepare(`
    UPDATE purchase_bills
    SET status = 'void', updatedAt = datetime('now')
    WHERE id = @id AND status <> 'void'
  `)
};

function requireInvoiceAndDate(billData = {}) {
  const invoice = typeof billData.invoice === 'string' ? billData.invoice.trim() : '';
  const date = typeof billData.date === 'string' ? billData.date.trim() : '';

  if (!invoice) throw validationError('Invoice number is required');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw validationError('A valid bill date is required');
  }

  return { invoice, date };
}

function normalizePurchaseLine(product = {}) {
  const name = cleanDisplay(product.name);
  if (!name) throw validationError('Every medicine line needs a name');

  const quantity = toNumber(product.stock ?? product.quantity);
  const free = toNumber(product.free);
  const unitPrice = toNumber(product.unitPrice ?? product.purchasePrice);
  const mrp = toNumber(product.mrp);
  const discount = toNumber(product.discount);
  const gstPercentage = toNumber(product.gstPercentage ?? product.gst);

  if (quantity <= 0) throw validationError(`Quantity for ${name} must be greater than 0`);
  if (free < 0) throw validationError(`Free quantity for ${name} cannot be negative`);
  if (unitPrice < 0 || mrp < 0 || discount < 0 || gstPercentage < 0) {
    throw validationError(`Rate, MRP, discount and GST for ${name} cannot be negative`);
  }
  if (discount > 100) throw validationError(`Discount for ${name} cannot exceed 100%`);

  const lineSubtotal = round2(unitPrice * quantity);
  const lineDiscount = round2(lineSubtotal * (discount / 100));
  const lineGst = round2((lineSubtotal - lineDiscount) * (gstPercentage / 100));

  return {
    id: Number(product.id) || null,
    name,
    batchNumber: cleanDisplay(product.batchNumber),
    expiryDate: cleanDisplay(product.expiryDate),
    quantity,
    free: round2(free),
    unitPrice,
    mrp,
    discount,
    gstPercentage,
    category: cleanDisplay(product.category),
    supplier: cleanDisplay(product.supplier),
    // undefined keeps the product's existing salt composition; [] clears it.
    salts: product.salts,
    lineSubtotal,
    lineDiscount,
    lineGst
  };
}

function computeTotals(lines) {
  let totalAmount = 0;
  let totalDiscount = 0;
  let totalGst = 0;

  for (const line of lines) {
    totalAmount += line.lineSubtotal;
    totalDiscount += line.lineDiscount;
    totalGst += line.lineGst;
  }

  totalAmount = round2(totalAmount);
  totalDiscount = round2(totalDiscount);
  totalGst = round2(totalGst);

  return {
    totalAmount,
    totalDiscount,
    totalGst,
    total: Math.round(totalAmount + totalGst - totalDiscount)
  };
}

function mapPurchaseItem(row, saltsByProduct = new Map()) {
  const salts = saltsByProduct.get(row.productId) ?? [];
  return {
    id: row.id,
    billId: row.purchaseBillId,
    purchaseBillId: row.purchaseBillId,
    productId: row.productId,
    inventoryItemId: row.inventoryItemId,
    name: row.nameSnapshot,
    batchNumber: row.batchNumberSnapshot,
    expiryDate: row.expiryDateSnapshot,
    stock: row.quantity,
    quantity: row.quantity,
    free: row.free ?? 0,
    unitPrice: row.unitPrice,
    mrp: row.mrp,
    discount: row.discount,
    gstPercentage: row.gstPercentage,
    supplier: row.supplierSnapshot,
    category: row.categorySnapshot,
    availableStock: row.availableStock ?? 0,
    salts,
    saltSummary: formatSaltSummary(salts)
  };
}

function loadBillProducts(billId) {
  const rows = statements.productsForBill.all(billId);
  const saltsByProduct = getSaltsForProductIds(rows.map((row) => row.productId));
  return rows.map((row) => mapPurchaseItem(row, saltsByProduct));
}

function loadBill(billId) {
  const bill = statements.getBill.get(Number(billId));
  if (!bill) return null;
  return {
    ...bill,
    products: loadBillProducts(bill.id)
  };
}

export function addBill(billData = {}) {
  const { invoice, date } = requireInvoiceAndDate(billData);
  const products = Array.isArray(billData.products) ? billData.products : [];

  if (products.length === 0) {
    throw validationError('At least one medicine line is required');
  }

  const requestedId = Number(billData.id);
  const billId = Number.isSafeInteger(requestedId) && requestedId > 0 ? requestedId : Date.now();
  const lines = products.map(normalizePurchaseLine);
  const totals = computeTotals(lines);

  const transaction = db.transaction(() => {
    if (statements.getBill.get(billId)) {
      throw conflictError('A purchase bill with this id already exists. Please retry.');
    }

    statements.insertBill.run({
      id: billId,
      invoice,
      date,
      supplierName: cleanDisplay(billData.supplierName) || null,
      supplierDrugLn: cleanDisplay(billData.supplierDrugLn) || null,
      supplierContact: cleanDisplay(billData.supplierContact) || null,
      totalAmount: totals.totalAmount,
      totalGst: totals.totalGst,
      totalDiscount: totals.totalDiscount,
      total: totals.total,
      type: cleanDisplay(billData.type) || 'Bill'
    });

    for (const line of lines) {
      const product = resolveProduct(line);

      if (line.salts !== undefined) {
        replaceProductSalts(product.id, line.salts);
      }

      const item = resolveInventoryItem(product.id, {
        ...line,
        supplier: line.supplier || cleanDisplay(billData.supplierName),
        receivedAt: date
      });

      statements.insertPurchaseItem.run({
        purchaseBillId: billId,
        productId: product.id,
        inventoryItemId: item.id,
        nameSnapshot: line.name,
        batchNumberSnapshot: line.batchNumber,
        expiryDateSnapshot: line.expiryDate,
        quantity: line.quantity,
        free: line.free,
        unitPrice: line.unitPrice,
        mrp: line.mrp,
        discount: line.discount,
        gstPercentage: line.gstPercentage,
        supplierSnapshot: line.supplier || cleanDisplay(billData.supplierName) || null,
        categorySnapshot: line.category || null
      });

      applyStockMovement({
        inventoryItemId: item.id,
        delta: round2(line.quantity + line.free),
        type: 'purchase',
        referenceType: 'purchase_bill',
        referenceId: billId,
        note: `Purchase bill ${invoice}${line.free > 0 ? ` (+${line.free} free)` : ''}`
      });
    }

    return { message: 'Bill saved successfully', billId, bill: loadBill(billId) };
  });

  return transaction.immediate();
}

export function updateBill(billId, billData = {}) {
  const id = Number(billId);

  if (!Number.isSafeInteger(id) || id <= 0) {
    throw validationError('Invalid bill id');
  }

  const { invoice, date } = requireInvoiceAndDate(billData);
  const products = Array.isArray(billData.products) ? billData.products : [];

  const transaction = db.transaction(() => {
    const existingBill = statements.getBill.get(id);

    if (!existingBill || existingBill.status === 'void') {
      return { updated: false, bill: null, products: [] };
    }

    const existingItems = statements.productsForBill.all(id);

    if (products.length !== existingItems.length) {
      throw validationError('All medicine lines must be included when updating a bill');
    }

    const existingById = new Map(existingItems.map((item) => [Number(item.id), item]));
    const seen = new Set();
    const normalized = products.map((product) => {
      const line = normalizePurchaseLine(product);
      const itemId = Number(product.id);

      if (!existingById.has(itemId)) {
        throw validationError('One or more medicine lines do not belong to this bill');
      }

      if (seen.has(itemId)) {
        throw validationError('Duplicate medicine line in the update');
      }

      seen.add(itemId);

      return { ...line, id: itemId };
    });

    const totals = computeTotals(normalized);

    for (const line of normalized) {
      const previous = existingById.get(line.id);
      const product = resolveProduct(line);

      if (line.salts !== undefined) {
        replaceProductSalts(product.id, line.salts);
      }

      const target = resolveInventoryItem(product.id, {
        ...line,
        supplier: previous.supplierSnapshot || cleanDisplay(billData.supplierName),
        receivedAt: date
      });

      if (previous.inventoryItemId === target.id) {
        const previousFree = toNumber(previous.free);
        const delta = round2(
          (line.quantity + line.free) - (previous.quantity + previousFree)
        );
        if (delta !== 0) {
          applyStockMovement({
            inventoryItemId: target.id,
            delta,
            type: 'purchase_edit',
            referenceType: 'purchase_bill',
            referenceId: id,
            note: `Quantity changed from ${previous.quantity}${previousFree ? ` + ${previousFree} free` : ''} to ${line.quantity}${line.free ? ` + ${line.free} free` : ''}`
          });
        }
      } else {
        // Batch/name changed: return the old units first, then receive the new ones.
        const previousFree = toNumber(previous.free);
        applyStockMovement({
          inventoryItemId: previous.inventoryItemId,
          delta: -round2(previous.quantity + previousFree),
          type: 'purchase_edit',
          referenceType: 'purchase_bill',
          referenceId: id,
          note: 'Batch changed while editing a purchase bill'
        });

        applyStockMovement({
          inventoryItemId: target.id,
          delta: round2(line.quantity + line.free),
          type: 'purchase_edit',
          referenceType: 'purchase_bill',
          referenceId: id,
          note: 'New batch added while editing a purchase bill'
        });
      }

      statements.updatePurchaseItem.run({
        id: line.id,
        purchaseBillId: id,
        productId: product.id,
        inventoryItemId: target.id,
        nameSnapshot: line.name,
        batchNumberSnapshot: line.batchNumber,
        expiryDateSnapshot: line.expiryDate,
        quantity: line.quantity,
        free: line.free,
        unitPrice: line.unitPrice,
        mrp: line.mrp,
        discount: line.discount,
        gstPercentage: line.gstPercentage,
        categorySnapshot: line.category || null
      });
    }

    statements.updateBill.run({
      id,
      invoice,
      date,
      supplierName: typeof billData.supplierName === 'string'
        ? billData.supplierName.trim()
        : existingBill.supplierName,
      supplierDrugLn: typeof billData.supplierDrugLn === 'string'
        ? billData.supplierDrugLn.trim()
        : existingBill.supplierDrugLn,
      supplierContact: typeof billData.supplierContact === 'string'
        ? billData.supplierContact.trim()
        : existingBill.supplierContact,
      totalAmount: totals.totalAmount,
      totalDiscount: totals.totalDiscount,
      totalGst: totals.totalGst,
      total: totals.total
    });

    return {
      updated: true,
      bill: loadBill(id),
      products: loadBillProducts(id)
    };
  });

  return transaction.immediate();
}

export function fetchBillsWithProducts({
  limit = DEFAULT_BILL_PAGE_SIZE,
  offset = 0,
  supplierName = '',
  supplierSearch = '',
  date = '',
  invoice = ''
} = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || DEFAULT_BILL_PAGE_SIZE, 1), 100);
  const safeOffset = Math.max(Number(offset) || 0, 0);
  const supplier = supplierName && supplierName.trim() !== ''
    ? supplierName.trim()
    : null;
  const supplierLike = supplierSearch && supplierSearch.trim() !== ''
    ? `%${supplierSearch.trim()}%`
    : null;
  const dateFilter = date && date.trim() !== ''
    ? `${date.trim()}%`
    : null;
  const invoiceFilter = invoice && invoice.trim() !== ''
    ? `%${invoice.trim()}%`
    : null;

  const params = {
    supplier,
    supplierSearch: supplierLike,
    date: dateFilter,
    invoice: invoiceFilter
  };

  const { total } = statements.countBills.get(params);
  const rows = statements.pageBills.all({
    ...params,
    limit: safeLimit,
    offset: safeOffset
  });

  const bills = rows.map((row) => ({
    ...row,
    products: loadBillProducts(row.id)
  }));

  return {
    bills,
    total,
    limit: safeLimit,
    offset: safeOffset,
    hasMore: safeOffset + bills.length < total
  };
}

export function fetchSupplierSummaries(filters = {}) {
  const options = typeof filters === 'string' ? { search: filters } : (filters || {});

  const search = options.search && options.search.trim() !== ''
    ? `%${options.search.trim()}%`
    : null;
  const date = options.date && options.date.trim() !== ''
    ? `${options.date.trim()}%`
    : null;
  const invoice = options.invoice && options.invoice.trim() !== ''
    ? `%${options.invoice.trim()}%`
    : null;

  return statements.supplierSummaries.all({ search, date, invoice });
}

/**
 * Voiding replaces hard deletion. Stock is reversed only when every unit from
 * the purchase is still on hand; otherwise the caller gets a clear conflict.
 */
export function deleteBill(billId) {
  const id = Number(billId);

  if (!Number.isSafeInteger(id) || id <= 0) {
    throw validationError('Invalid bill id');
  }

  const transaction = db.transaction(() => {
    const bill = statements.getBill.get(id);

    if (!bill) {
      return { deleted: false, bill: null, productsDeleted: 0 };
    }

    if (bill.status === 'void') {
      return { deleted: false, bill, productsDeleted: 0, alreadyVoid: true };
    }

    const items = statements.productsForBill.all(id);
    const requiredByInventory = new Map();

    for (const item of items) {
      if (!item.inventoryItemId) continue;
      requiredByInventory.set(
        item.inventoryItemId,
        round2(
          (requiredByInventory.get(item.inventoryItemId) ?? 0) +
            item.quantity +
            (Number(item.free) || 0)
        )
      );
    }

    for (const [inventoryItemId, required] of requiredByInventory) {
      const live = db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(inventoryItemId);
      if (!live || live.quantity < required) {
        throw conflictError(
          `Cannot void this bill because ${Number(required) - Number(live?.quantity ?? 0)} unit(s) from it have already been sold or adjusted.`
        );
      }
    }

    for (const [inventoryItemId, required] of requiredByInventory) {
      applyStockMovement({
        inventoryItemId,
        delta: -required,
        type: 'void',
        referenceType: 'purchase_bill',
        referenceId: id,
        note: `Purchase bill ${bill.invoice} voided`
      });
    }

    statements.voidBill.run({ id });

    return {
      deleted: true,
      voided: true,
      bill: loadBill(id),
      productsDeleted: items.length
    };
  });

  return transaction.immediate();
}

export function fetchPurchaseBillById(billId) {
  return loadBill(billId);
}
