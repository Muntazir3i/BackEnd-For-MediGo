/**
 * Controller for managing bill-related database operations using SQLite.
 * 
 * This controller handles inserting new bills along with their associated
 * products into the database within a transaction. It also provides 
 * functionality to fetch all existing bills and seamlessly maps their 
 * respective products to them.
 */

import db from '../db/billPayment.js';

// 1. Pre-compile statements for better performance
const statements = {
  insertBill: db.prepare(`
    INSERT INTO bills (id, invoice, date, supplierName, supplierDrugLn, supplierContact, totalAmount, totalGst, totalDiscount, total, type)
    VALUES (@id, @invoice, @date, @supplierName, @supplierDrugLn, @supplierContact, @totalAmount, @totalGst, @totalDiscount, @total, @type)
  `),
  insertProduct: db.prepare(`
    INSERT INTO bill_products (id, billId, name, batchNumber, expiryDate, stock, unitPrice, mrp, discount, gstPercentage, supplier, category)
    VALUES (@id, @billId, @name, @batchNumber, @expiryDate, @stock, @unitPrice, @mrp, @discount, @gstPercentage, @supplier, @category)
  `),
  fetchBillsWithProducts: db.prepare(`
    SELECT 
      b.id AS billId,
      b.invoice,
      b.date,
      b.supplierName,
      b.supplierDrugLn,
      b.supplierContact,
      b.totalAmount,
      b.totalGst,
      b.totalDiscount,
      b.total,
      b.type,
      p.id AS productId,
      p.name AS productName,
      p.batchNumber,
      p.expiryDate,
      p.stock,
      p.unitPrice,
      p.mrp,
      p.discount,
      p.gstPercentage,
      p.supplier AS productSupplier,
      p.category AS productCategory
    FROM 
      bills b
    LEFT JOIN 
      bill_products p
    ON 
      b.id = p.billId
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

function fetchBillsWithProducts() {
  const rows = statements.fetchBillsWithProducts.all();

  // Group the results by billId
  const bills = rows.reduce((acc, row) => {
    const billId = row.billId;

    // Check if the billId already exists in the accumulator
    if (!acc[billId]) {
      acc[billId] = {
        id: billId,
        invoice: row.invoice,
        date: row.date,
        supplierName: row.supplierName,
        supplierDrugLn: row.supplierDrugLn,
        supplierContact: row.supplierContact,
        totalAmount: row.totalAmount,
        totalGst: row.totalGst,
        totalDiscount: row.totalDiscount,
        total: row.total,
        type: row.type,
        products: [] // Initialize an empty array for products
      };
    }

    // If there's a product associated with the bill, push it to the products array
    if (row.productId) {
      acc[billId].products.push({
        id: row.productId,
        name: row.productName,
        batchNumber: row.batchNumber,
        expiryDate: row.expiryDate,
        stock: row.stock,
        unitPrice: row.unitPrice,
        mrp: row.mrp,
        discount: row.discount,
        gstPercentage: row.gstPercentage,
        supplier: row.productSupplier,
        category: row.productCategory
      });
    }

    return acc;
  }, {});

  // Convert the object to an array of bills
  return Object.values(bills);
}

export { addBill, fetchBillsWithProducts };