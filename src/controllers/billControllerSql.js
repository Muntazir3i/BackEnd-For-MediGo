/**
 * Controller for managing bill-related database operations using SQLite.
 *
 * This controller handles inserting new bills along with their associated
 * products into the database within a transaction. Bills are fetched in small
 * pages (5 by default) so the inventory screen stays fast even when there are
 * thousands of bills.
 */

import db from '../db/billPayment.js';

export const DEFAULT_BILL_PAGE_SIZE = 5;

// 1. Pre-compile statements for better performance
// This avoids parsing the SQL string on every function call.
const statements = {
  insertBill: db.prepare(`
    INSERT INTO bills (id, invoice, date, supplierName, supplierDrugLn, supplierContact, totalAmount, totalGst, totalDiscount, total, type)
    VALUES (@id, @invoice, @date, @supplierName, @supplierDrugLn, @supplierContact, @totalAmount, @totalGst, @totalDiscount, @total, @type)
  `),
  insertProduct: db.prepare(`
    INSERT INTO bill_products (id, billId, name, batchNumber, expiryDate, stock, unitPrice, mrp, discount, gstPercentage, supplier, category)
    VALUES (@id, @billId, @name, @batchNumber, @expiryDate, @stock, @unitPrice, @mrp, @discount, @gstPercentage, @supplier, @category)
  `),
  countBills: db.prepare(`
    SELECT COUNT(*) AS total
    FROM bills
    WHERE (type = 'Bill' OR (type IS NULL AND supplierName IS NOT NULL))
      AND (@supplier IS NULL OR supplierName = @supplier)
      AND (@supplierSearch IS NULL OR supplierName LIKE @supplierSearch)
      AND (@date IS NULL OR date LIKE @date)
      AND (@invoice IS NULL OR invoice LIKE @invoice)
  `),
  pageBills: db.prepare(`
    SELECT *
    FROM bills
    WHERE (type = 'Bill' OR (type IS NULL AND supplierName IS NOT NULL))
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
    FROM bills
    WHERE (type = 'Bill' OR (type IS NULL AND supplierName IS NOT NULL))
      AND supplierName IS NOT NULL
      AND (@search IS NULL OR supplierName LIKE @search)
      AND (@date IS NULL OR date LIKE @date)
      AND (@invoice IS NULL OR invoice LIKE @invoice)
    GROUP BY supplierName
    ORDER BY supplierName COLLATE NOCASE ASC
  `),
  productsForBill: db.prepare(`
    SELECT *
    FROM bill_products
    WHERE billId = ?
    ORDER BY id ASC
  `),
  getBill: db.prepare(`
    SELECT *
    FROM bills
    WHERE id = ?
  `),
  updateBill: db.prepare(`
    UPDATE bills
    SET invoice = @invoice,
        date = @date,
        supplierName = @supplierName,
        supplierDrugLn = @supplierDrugLn,
        supplierContact = @supplierContact,
        totalAmount = @totalAmount,
        totalGst = @totalGst,
        totalDiscount = @totalDiscount,
        total = @total
    WHERE id = @id
  `),
  updateProduct: db.prepare(`
    UPDATE bill_products
    SET name = @name,
        batchNumber = @batchNumber,
        expiryDate = @expiryDate,
        stock = @stock,
        unitPrice = @unitPrice,
        mrp = @mrp,
        discount = @discount,
        gstPercentage = @gstPercentage,
        category = @category
    WHERE id = @id AND billId = @billId
  `),
  deleteProductsForBill: db.prepare(`
    DELETE FROM bill_products
    WHERE billId = ?
  `),
  deleteBill: db.prepare(`
    DELETE FROM bills
    WHERE id = ?
  `)
};

function addBill(billData) {
  const transaction = db.transaction(() => {
    // 2. Use named parameters with fallbacks
    statements.insertBill.run({
      id: billData.id,
      invoice: billData.invoice || null,
      date: billData.date || null,
      supplierName: billData.supplierName || null,
      supplierDrugLn: billData.supplierDrugLn || null,
      supplierContact: billData.supplierContact || null,
      totalAmount: billData.totalAmount || 0,
      totalGst: billData.totalGst || 0,
      totalDiscount: billData.totalDiscount || 0,
      total: billData.total || 0,
      type: billData.type || null
    });

    const products = billData.products || [];
    for (const product of products) {
      statements.insertProduct.run({
        id: product.id,
        billId: billData.id,
        name: product.name || null,
        batchNumber: product.batchNumber || null,
        expiryDate: product.expiryDate || null,
        stock: product.stock || 0,
        unitPrice: product.unitPrice || 0,
        mrp: product.mrp || 0,
        discount: product.discount || 0,
        gstPercentage: product.gstPercentage || 0,
        supplier: product.supplier || null,
        category: product.category || null
      });
    }
  });

  transaction();

  return { message: 'Bill saved successfully', billId: billData.id };
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Update a purchase bill and all of its medicine lines in one transaction.
 * Totals are recalculated on the server from the edited medicine values so the
 * stored bill always matches its products.
 *
 * @param {number|string} billId
 * @param {Object} billData
 * @returns {{updated: boolean, bill: Object|null, products: Array<Object>}}
 */
function updateBill(billId, billData = {}) {
  const id = Number(billId);

  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error('Invalid bill id');
  }

  const invoice = typeof billData.invoice === 'string' ? billData.invoice.trim() : '';
  const date = typeof billData.date === 'string' ? billData.date.trim() : '';

  if (!invoice) {
    throw new Error('Invoice number is required');
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error('A valid bill date is required');
  }

  const products = Array.isArray(billData.products) ? billData.products : [];

  const transaction = db.transaction(() => {
    const existingBill = statements.getBill.get(id);

    if (!existingBill) {
      return { updated: false, bill: null, products: [] };
    }

    const existingProducts = statements.productsForBill.all(id);

    // Only existing lines can be edited. Keeping the line count fixed prevents
    // accidentally dropping medicine rows because of a malformed request.
    if (products.length !== existingProducts.length) {
      throw new Error('All medicine lines must be included when updating a bill');
    }

    const existingById = new Map(
      existingProducts.map((product) => [Number(product.id), product])
    );
    const seen = new Set();

    const normalizedProducts = products.map((product) => {
      const productId = Number(product.id);

      if (!existingById.has(productId)) {
        throw new Error('One or more medicine lines do not belong to this bill');
      }

      if (seen.has(productId)) {
        throw new Error('Duplicate medicine line in the update');
      }

      seen.add(productId);

      const name = String(product.name ?? '').trim();
      const stock = toNumber(product.stock);
      const unitPrice = toNumber(product.unitPrice);
      const mrp = toNumber(product.mrp);
      const discount = toNumber(product.discount);
      const gstPercentage = toNumber(product.gstPercentage);

      if (!name) {
        throw new Error('Every medicine line needs a name');
      }

      if (stock <= 0) {
        throw new Error(`Quantity for ${name} must be greater than 0`);
      }

      if (unitPrice < 0 || mrp < 0 || discount < 0 || gstPercentage < 0) {
        throw new Error(`Rate, MRP, discount and GST for ${name} cannot be negative`);
      }

      return {
        id: productId,
        name,
        batchNumber: String(product.batchNumber ?? '').trim(),
        expiryDate: String(product.expiryDate ?? '').trim(),
        stock,
        unitPrice,
        mrp,
        discount,
        gstPercentage,
        category: String(product.category ?? '').trim()
      };
    });

    let totalAmount = 0;
    let totalDiscount = 0;
    let totalGst = 0;

    for (const product of normalizedProducts) {
      const lineSubtotal = product.unitPrice * product.stock;
      const lineDiscount = lineSubtotal * (product.discount / 100);
      const lineGst = (lineSubtotal - lineDiscount) * (product.gstPercentage / 100);

      totalAmount += lineSubtotal;
      totalDiscount += lineDiscount;
      totalGst += lineGst;

      statements.updateProduct.run({
        ...product,
        billId: id
      });
    }

    totalAmount = round2(totalAmount);
    totalDiscount = round2(totalDiscount);
    totalGst = round2(totalGst);

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
      totalAmount,
      totalDiscount,
      totalGst,
      total: Math.round(totalAmount + totalGst - totalDiscount)
    });

    return {
      updated: true,
      bill: statements.getBill.get(id),
      products: statements.productsForBill.all(id)
    };
  });

  return transaction();
}

/**
 * Fetch a page of bills (with their products) newest first.
 *
 * @param {Object} options
 * @param {number} [options.limit=5]          Maximum bills to return.
 * @param {number} [options.offset=0]         Number of bills to skip.
 * @param {string} [options.supplierName]     Optional exact supplier name filter.
 * @param {string} [options.supplierSearch]   Optional partial supplier name filter.
 * @param {string} [options.date]             Optional bill date (YYYY-MM-DD).
 * @param {string} [options.invoice]          Optional invoice/bill number filter.
 * @returns {{
 *   bills: Array<Object>,
 *   total: number,
 *   limit: number,
 *   offset: number,
 *   hasMore: boolean
 * }}
 */
function fetchBillsWithProducts({
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
  // Use a prefix match so dates stored with a time component are included.
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
    products: statements.productsForBill.all(row.id)
  }));

  return {
    bills,
    total,
    limit: safeLimit,
    offset: safeOffset,
    hasMore: safeOffset + bills.length < total
  };
}

/**
 * Fetch the list of suppliers with their total bill count and amount.
 * Returns every supplier by default; pass filters to narrow the result.
 *
 * @param {string|Object} [filters]
 * @param {string} [filters.search]   Partial supplier name.
 * @param {string} [filters.date]     Bill date (YYYY-MM-DD).
 * @param {string} [filters.invoice]  Partial invoice/bill number.
 * @returns {Array<{supplierName: string, supplierDrugLn: string, billCount: number, total: number}>}
 */
function fetchSupplierSummaries(filters = {}) {
  // Backwards compatibility: previously this function accepted a plain search string.
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
 * Delete a purchase bill and every product row that belongs to it.
 * Runs in a single transaction so a bill can never be left without its products.
 *
 * @param {number|string} billId
 * @returns {{deleted: boolean, bill: Object|null, productsDeleted: number}}
 */
function deleteBill(billId) {
  const id = Number(billId);

  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error('Invalid bill id');
  }

  const transaction = db.transaction(() => {
    const bill = statements.getBill.get(id);

    if (!bill) {
      return { deleted: false, bill: null, productsDeleted: 0 };
    }

    const products = statements.deleteProductsForBill.run(id);
    statements.deleteBill.run(id);

    return {
      deleted: true,
      bill,
      productsDeleted: products.changes
    };
  });

  return transaction();
}

export { addBill, deleteBill, fetchBillsWithProducts, fetchSupplierSummaries, updateBill };
