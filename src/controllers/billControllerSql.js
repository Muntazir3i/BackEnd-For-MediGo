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
    GROUP BY supplierName
    ORDER BY supplierName COLLATE NOCASE ASC
  `),
  productsForBill: db.prepare(`
    SELECT *
    FROM bill_products
    WHERE billId = ?
    ORDER BY id ASC
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
 * Returns every supplier by default; pass `search` to filter by name.
 *
 * @param {string} [search]
 * @returns {Array<{supplierName: string, supplierDrugLn: string, billCount: number, total: number}>}
 */
function fetchSupplierSummaries(search = '') {
  const term = search && search.trim() !== ''
    ? `%${search.trim()}%`
    : null;

  return statements.supplierSummaries.all({ search: term });
}

export { addBill, fetchBillsWithProducts, fetchSupplierSummaries };
