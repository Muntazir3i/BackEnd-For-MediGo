/**
 * Hidden business insights.
 *
 * The page is intentionally not linked from the sidebar. It is reachable only
 * through the command palette.
 */
import db from '../db/billPayment.js';
import supplierDb from '../db/db.js';

const pad = (value) => String(value).padStart(2, '0');

function isoDate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function monthKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

function monthLabel(date) {
  return date.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
}

function addMonths(date, count) {
  return new Date(date.getFullYear(), date.getMonth() + count, 1);
}

function addDays(date, count) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + count);
}

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

const FORM_TOKENS = new Set([
  'TAB', 'TABLET', 'TABS', 'TABLETS',
  'CAP', 'CAPSULE', 'CAPSULES',
  'SYP', 'SYRUP',
  'SUSP', 'SUSPENSION',
  'INJ', 'INJECTION',
  'DROP', 'DROPS',
  'OINT', 'OINTMENT',
  'CREAM', 'GEL', 'LOTION', 'SPRAY',
  'INHALER', 'SACHET', 'POWDER', 'SOAP', 'SHAMPOO',
  'NANOSHOT', 'MOUTHWASH', 'PATCH', 'SUPPOSITORY', 'GRANULES',
]);

const NOISE_TOKENS = new Set([
  'TRANSPULES', 'TRANSPULE', 'TRANSPULS',
  'NEW', 'ADVANCE', 'ADVANCED', 'SPECIAL', 'PACK', 'PACKS',
]);

function medicineGroupKey(name) {
  const text = String(name || '')
    .toUpperCase()
    .replace(/NANO[\s-]*SHOT/g, ' NANOSHOT ')
    .replace(/MOUTH[\s-]*WASH/g, ' MOUTHWASH ')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();

  const tokens = text.split(/\s+/).filter(Boolean);
  const forms = [];
  const base = [];

  for (const token of tokens) {
    if (FORM_TOKENS.has(token)) forms.push(token);
    else if (!NOISE_TOKENS.has(token)) base.push(token);
  }

  return `${base.join(' ')}|${forms.sort().join(' ')}`;
}

function groupPriceRows(rows) {
  const groups = new Map();

  for (const row of rows) {
    const key = medicineGroupKey(row.name);
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        quantity: 0,
        amount: 0,
        names: new Map()
      });
    }

    const group = groups.get(key);
    const quantity = Number(row.quantity) || 0;
    const amount = Number(row.amount) || 0;

    group.quantity += quantity;
    group.amount += amount;
    group.names.set(row.name, (group.names.get(row.name) || 0) + quantity);
  }

  return groups;
}

function pickGroupName(group) {
  return [...group.names.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0]?.[0] || '';
}

const statements = {
  purchaseTotals: db.prepare(`
    SELECT COALESCE(SUM(total), 0) AS amount, COUNT(*) AS count
    FROM purchase_bills
    WHERE status <> 'void'
      AND date >= ? AND date < ?
  `),
  paymentTotals: db.prepare(`
    SELECT COALESCE(SUM(total), 0) AS amount, COUNT(*) AS count
    FROM payments
    WHERE date >= ? AND date < ?
  `),
  salesTotals: db.prepare(`
    SELECT COALESCE(SUM(total), 0) AS amount, COUNT(*) AS count
    FROM invoices
    WHERE status <> 'voided'
      AND createdAt >= ? AND createdAt < ?
  `),
  creditTotals: db.prepare(`
    SELECT COALESCE(SUM(total), 0) AS amount, COUNT(*) AS count
    FROM credit_notes
    WHERE date >= ? AND date < ?
  `),
  purchaseMonthly: db.prepare(`
    SELECT substr(date, 1, 7) AS month, COALESCE(SUM(total), 0) AS amount, COUNT(*) AS count
    FROM purchase_bills
    WHERE status <> 'void'
      AND date >= ? AND date < ?
    GROUP BY month
  `),
  paymentMonthly: db.prepare(`
    SELECT substr(date, 1, 7) AS month, COALESCE(SUM(total), 0) AS amount, COUNT(*) AS count
    FROM payments
    WHERE date >= ? AND date < ?
    GROUP BY month
  `),
  salesMonthly: db.prepare(`
    SELECT substr(createdAt, 1, 7) AS month, COALESCE(SUM(total), 0) AS amount, COUNT(*) AS count
    FROM invoices
    WHERE status <> 'voided'
      AND createdAt >= ? AND createdAt < ?
    GROUP BY month
  `),
  creditMonthly: db.prepare(`
    SELECT substr(date, 1, 7) AS month, COALESCE(SUM(total), 0) AS amount, COUNT(*) AS count
    FROM credit_notes
    WHERE date >= ? AND date < ?
    GROUP BY month
  `),
  topSuppliers: db.prepare(`
    SELECT supplierName, COALESCE(SUM(total), 0) AS amount, COUNT(*) AS bills
    FROM purchase_bills
    WHERE status <> 'void'
      AND supplierName IS NOT NULL
      AND date >= ? AND date < ?
    GROUP BY supplierName
    ORDER BY amount DESC
    LIMIT 5
  `),
  topProducts: db.prepare(`
    SELECT
      MIN(nameSnapshot) AS name,
      COALESCE(SUM(quantity), 0) AS quantity,
      COALESCE(SUM(quantity * unitPrice), 0) AS amount
    FROM purchase_items pi
    JOIN purchase_bills pb ON pb.id = pi.purchaseBillId
    WHERE pb.status <> 'void'
      AND pb.date >= ? AND pb.date < ?
    GROUP BY COALESCE(pi.productId, UPPER(TRIM(pi.nameSnapshot)))
    ORDER BY amount DESC
    LIMIT 8
  `),
  medicinePurchaseStats: db.prepare(`
    SELECT
      pi.productId,
      MAX(COALESCE(p.name, pi.nameSnapshot)) AS name,
      COUNT(DISTINCT pi.purchaseBillId) AS orderCount,
      COUNT(*) AS lineCount,
      COALESCE(SUM(pi.quantity), 0) AS totalQuantity,
      COALESCE(SUM(pi.free), 0) AS freeQuantity,
      COALESCE(SUM(pi.quantity * pi.unitPrice), 0) AS grossAmount,
      COALESCE(SUM(
        (pi.quantity * pi.unitPrice)
        * (1 - (pi.discount / 100.0))
        * (1 + (pi.gstPercentage / 100.0))
      ), 0) AS totalAmount,
      CASE
        WHEN SUM(pi.quantity) > 0 THEN SUM(pi.quantity * pi.unitPrice) / SUM(pi.quantity)
        ELSE 0
      END AS averageRate,
      MAX(pb.date) AS lastOrderedDate
    FROM purchase_items pi
    JOIN purchase_bills pb ON pb.id = pi.purchaseBillId
    LEFT JOIN products p ON p.id = pi.productId
    WHERE pb.status <> 'void'
      AND (@search IS NULL OR pi.nameSnapshot LIKE @search OR p.name LIKE @search)
    GROUP BY COALESCE(pi.productId, UPPER(TRIM(pi.nameSnapshot)))
    ORDER BY orderCount DESC, totalAmount DESC
    LIMIT @limit
  `),
  priceHistoryMatches: db.prepare(`
    SELECT
      pi.productId,
      MAX(COALESCE(p.name, pi.nameSnapshot)) AS name,
      COUNT(*) AS lineCount,
      MAX(pb.date) AS lastPurchased
    FROM purchase_items pi
    JOIN purchase_bills pb ON pb.id = pi.purchaseBillId
    LEFT JOIN products p ON p.id = pi.productId
    WHERE pb.status <> 'void'
      AND (pi.nameSnapshot LIKE @search OR p.name LIKE @search)
    GROUP BY COALESCE(pi.productId, UPPER(TRIM(pi.nameSnapshot)))
    ORDER BY lineCount DESC, lastPurchased DESC
    LIMIT 12
  `),
  priceHistoryPoints: db.prepare(`
    SELECT
      pb.date AS date,
      MAX(pb.invoice) AS invoice,
      MAX(pb.supplierName) AS supplierName,
      MAX(pi.nameSnapshot) AS name,
      COALESCE(
        SUM(pi.quantity * pi.unitPrice) / NULLIF(SUM(pi.quantity), 0),
        MAX(pi.unitPrice)
      ) AS unitPrice,
      COALESCE(
        SUM(pi.quantity * pi.gstPercentage) / NULLIF(SUM(pi.quantity), 0),
        MAX(pi.gstPercentage)
      ) AS gstPercentage,
      COALESCE(
        SUM(pi.quantity * pi.mrp) / NULLIF(SUM(pi.quantity), 0),
        MAX(pi.mrp)
      ) AS mrp,
      COALESCE(SUM(pi.quantity), 0) AS quantity,
      COUNT(*) AS lines
    FROM purchase_items pi
    JOIN purchase_bills pb ON pb.id = pi.purchaseBillId
    WHERE pb.status <> 'void'
      AND (
        (@productId IS NOT NULL AND pi.productId = @productId)
        OR (@productId IS NULL AND pi.nameSnapshot = @name COLLATE NOCASE)
      )
    GROUP BY pb.date
    ORDER BY pb.date ASC
    LIMIT 200
  `),
  lastYearSummary: db.prepare(`
    SELECT
      COUNT(DISTINCT pi.purchaseBillId) AS billCount,
      COUNT(DISTINCT UPPER(TRIM(pi.nameSnapshot))) AS productCount,
      COALESCE(SUM(pi.quantity * pi.unitPrice), 0) AS amount
    FROM purchase_items pi
    JOIN purchase_bills pb ON pb.id = pi.purchaseBillId
    WHERE pb.status <> 'void'
      AND pb.date >= ? AND pb.date < ?
  `),
  lastYearProducts: db.prepare(`
    SELECT
      MIN(pi.nameSnapshot) AS name,
      COALESCE(SUM(pi.quantity), 0) AS quantity,
      COUNT(DISTINCT pi.purchaseBillId) AS orders,
      COALESCE(SUM(pi.quantity * pi.unitPrice), 0) AS amount
    FROM purchase_items pi
    JOIN purchase_bills pb ON pb.id = pi.purchaseBillId
    WHERE pb.status <> 'void'
      AND pb.date >= ? AND pb.date < ?
    GROUP BY COALESCE(pi.productId, UPPER(TRIM(pi.nameSnapshot)))
    ORDER BY quantity DESC
    LIMIT 8
  `),
  rediscover: db.prepare(`
    SELECT
      MIN(pi.nameSnapshot) AS name,
      COALESCE(SUM(pi.quantity), 0) AS quantity,
      COUNT(DISTINCT pi.purchaseBillId) AS orders,
      MAX(pb.date) AS lastPurchased
    FROM purchase_items pi
    JOIN purchase_bills pb ON pb.id = pi.purchaseBillId
    WHERE pb.status <> 'void'
      AND pb.date >= ? AND pb.date < ?
      AND NOT EXISTS (
        SELECT 1
        FROM purchase_items recent
        JOIN purchase_bills rb ON rb.id = recent.purchaseBillId
        WHERE rb.status <> 'void'
          AND rb.date >= ?
          AND recent.productId = pi.productId
      )
    GROUP BY pi.productId
    ORDER BY quantity DESC
    LIMIT 6
  `),
  productPriceRows: db.prepare(`
    SELECT
      pi.productId,
      p.name,
      SUM(pi.quantity) AS quantity,
      SUM(pi.quantity * pi.unitPrice) AS amount
    FROM purchase_items pi
    JOIN purchase_bills pb ON pb.id = pi.purchaseBillId
    JOIN products p ON p.id = pi.productId
    WHERE pb.status <> 'void' AND pi.productId IS NOT NULL
      AND pb.date >= ? AND pb.date < ?
    GROUP BY pi.productId
  `),
  outstandingBySupplier: db.prepare(`
    SELECT supplierName, COALESCE(SUM(signedAmount), 0) AS net
    FROM supplier_transactions
    WHERE supplierName IS NOT NULL
    GROUP BY supplierName
  `),
  frequentProducts: db.prepare(`
    SELECT
      MIN(pi.nameSnapshot) AS name,
      COUNT(DISTINCT pi.purchaseBillId) AS bills,
      COALESCE(SUM(pi.quantity), 0) AS quantity
    FROM purchase_items pi
    JOIN purchase_bills pb ON pb.id = pi.purchaseBillId
    WHERE pb.status <> 'void'
      AND pb.date >= ? AND pb.date < ?
    GROUP BY COALESCE(pi.productId, UPPER(TRIM(pi.nameSnapshot)))
    ORDER BY bills DESC, quantity DESC
    LIMIT 6
  `),
  missingData: db.prepare(`
    SELECT
      SUM(CASE WHEN pi.batchNumberSnapshot IS NULL OR TRIM(pi.batchNumberSnapshot) = '' THEN 1 ELSE 0 END) AS missingBatch,
      SUM(CASE WHEN pi.expiryDateSnapshot IS NULL OR TRIM(pi.expiryDateSnapshot) = '' THEN 1 ELSE 0 END) AS missingExpiry
    FROM purchase_items pi
    JOIN purchase_bills pb ON pb.id = pi.purchaseBillId
    WHERE pb.status <> 'void'
  `),
  activeProductNames: db.prepare(`
    SELECT name FROM products WHERE isActive = 1
  `),
  reorderCandidates: db.prepare(`
    WITH recent AS (
      SELECT pi.productId, SUM(pi.quantity) AS quantity
      FROM purchase_items pi
      JOIN purchase_bills pb ON pb.id = pi.purchaseBillId
      WHERE pb.status <> 'void' AND pi.productId IS NOT NULL
        AND pb.date >= ? AND pb.date < ?
      GROUP BY pi.productId
    )
    SELECT
      p.name,
      ps.stockOnHand,
      r.quantity AS recentQuantity,
      r.quantity / 3.0 AS averageMonthly
    FROM recent r
    JOIN products p ON p.id = r.productId
    JOIN product_stock ps ON ps.productId = p.id
    WHERE p.isActive = 1
      AND r.quantity > 0
      AND ps.stockOnHand <= (r.quantity / 3.0) * 1.5
    ORDER BY ((r.quantity / 3.0) - ps.stockOnHand) DESC
    LIMIT 6
  `)
};

const supplierStatements = {
  balances: supplierDb.prepare(`
    SELECT supplierName, supplierBalance
    FROM suppliers
  `)
};

function mergeMonthly(months, rows, field) {
  const byMonth = new Map(rows.map((row) => [row.month, row]));

  return months.map((month) => {
    const row = byMonth.get(month.month);
    return {
      ...month,
      [field]: row ? Number(row.amount) || 0 : 0,
      [`${field}Count`]: row ? Number(row.count) || 0 : 0
    };
  });
}

function getInsights(req, res) {
  const now = new Date();
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const windowStart = addMonths(currentMonthStart, -12);
  const windowEnd = currentMonthStart;

  const lastYearMonthStart = new Date(now.getFullYear() - 1, now.getMonth(), 1);
  const lastYearMonthEnd = addMonths(lastYearMonthStart, 1);
  const recentStart = isoDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 90));
  const today = isoDate(now);
  const last90Start = isoDate(addDays(now, -90));
  const previous90Start = isoDate(addDays(now, -180));

  const from = isoDate(windowStart);
  const to = isoDate(windowEnd);
  const lastYearFrom = isoDate(lastYearMonthStart);
  const lastYearTo = isoDate(lastYearMonthEnd);

  const months = Array.from({ length: 12 }, (_, index) => {
    const date = addMonths(windowStart, index);
    return {
      month: monthKey(date),
      label: monthLabel(date),
      purchases: 0,
      purchasesCount: 0,
      payments: 0,
      paymentsCount: 0,
      sales: 0,
      salesCount: 0,
      creditNotes: 0,
      creditNotesCount: 0
    };
  });

  const purchases = statements.purchaseTotals.get(from, to);
  const payments = statements.paymentTotals.get(from, to);
  const sales = statements.salesTotals.get(from, to);
  const creditNotes = statements.creditTotals.get(from, to);

  let monthlySeries = mergeMonthly(months, statements.purchaseMonthly.all(from, to), 'purchases');
  monthlySeries = mergeMonthly(monthlySeries, statements.paymentMonthly.all(from, to), 'payments');
  monthlySeries = mergeMonthly(monthlySeries, statements.salesMonthly.all(from, to), 'sales');
  monthlySeries = mergeMonthly(monthlySeries, statements.creditMonthly.all(from, to), 'creditNotes');

  const totalPurchases = Number(purchases.amount) || 0;
  const totalPayments = Number(payments.amount) || 0;
  const totalSales = Number(sales.amount) || 0;
  const totalCreditNotes = Number(creditNotes.amount) || 0;
  const monthCount = monthlySeries.length;

  const bestPurchaseMonth = monthlySeries.reduce(
    (best, month) => (month.purchases > best.purchases ? month : best),
    monthlySeries[0]
  );
  const bestPaymentMonth = monthlySeries.reduce(
    (best, month) => (month.payments > best.payments ? month : best),
    monthlySeries[0]
  );

  const topSuppliers = statements.topSuppliers.all(from, to).map((row) => ({
    supplierName: row.supplierName,
    amount: round2(row.amount),
    bills: Number(row.bills) || 0
  }));

  const lastYearSummary = statements.lastYearSummary.get(lastYearFrom, lastYearTo);
  const reorderCandidates = statements.reorderCandidates.all(last90Start, today);

  const recentPriceGroups = groupPriceRows(
    statements.productPriceRows.all(last90Start, today)
  );
  const previousPriceGroups = groupPriceRows(
    statements.productPriceRows.all(previous90Start, last90Start)
  );
  const priceMoves = [];

  for (const [key, recent] of recentPriceGroups.entries()) {
    const previous = previousPriceGroups.get(key);
    if (!previous || recent.quantity <= 0 || previous.quantity <= 0) continue;

    const previousPrice = previous.amount / previous.quantity;
    const recentPrice = recent.amount / recent.quantity;
    if (!(previousPrice > 0)) continue;

    const matchedNames = [...new Set([
      ...recent.names.keys(),
      ...previous.names.keys()
    ])];

    priceMoves.push({
      name: pickGroupName(recent) || pickGroupName(previous),
      matchedNames,
      previousPrice: round2(previousPrice),
      recentPrice: round2(recentPrice),
      changePercent: round2(((recentPrice - previousPrice) / previousPrice) * 100)
    });
  }

  priceMoves.sort((a, b) => b.changePercent - a.changePercent);
  priceMoves.splice(6);

  const previousMonthStart = addMonths(currentMonthStart, -1);
  const nextMonthStart = addMonths(currentMonthStart, 1);
  const currentPurchases = statements.purchaseTotals.get(
    isoDate(currentMonthStart),
    isoDate(nextMonthStart)
  );
  const previousPurchases = statements.purchaseTotals.get(
    isoDate(previousMonthStart),
    isoDate(currentMonthStart)
  );
  const currentPayments = statements.paymentTotals.get(
    isoDate(currentMonthStart),
    isoDate(nextMonthStart)
  );
  const previousPayments = statements.paymentTotals.get(
    isoDate(previousMonthStart),
    isoDate(currentMonthStart)
  );

  const currentPurchaseAmount = Number(currentPurchases.amount) || 0;
  const previousPurchaseAmount = Number(previousPurchases.amount) || 0;
  const currentPaymentAmount = Number(currentPayments.amount) || 0;
  const previousPaymentAmount = Number(previousPayments.amount) || 0;

  const openingBySupplier = new Map(
    supplierStatements.balances.all().map((row) => [
      row.supplierName,
      Number(row.supplierBalance) || 0
    ])
  );

  const outstandingSuppliers = statements.outstandingBySupplier
    .all()
    .map((row) => ({
      supplierName: row.supplierName,
      balance: round2((openingBySupplier.get(row.supplierName) || 0) + (Number(row.net) || 0))
    }))
    .filter((row) => row.balance > 0)
    .sort((a, b) => b.balance - a.balance);

  const totalOutstanding = round2(
    outstandingSuppliers.reduce((sum, row) => sum + row.balance, 0)
  );

  const missingData = statements.missingData.get();
  const productNameGroups = new Map();

  for (const { name } of statements.activeProductNames.all()) {
    const key = medicineGroupKey(name);
    if (!productNameGroups.has(key)) productNameGroups.set(key, []);
    productNameGroups.get(key).push(name);
  }

  const duplicateGroups = [...productNameGroups.values()]
    .filter((names) => new Set(names).size > 1)
    .sort((a, b) => b.length - a.length);

  return res.status(200).json({
    generatedAt: new Date().toISOString(),
    period: {
      from,
      to,
      months: monthCount,
      label: `${monthLabel(windowStart)} – ${monthLabel(addMonths(windowEnd, -1))}`
    },
    lastYearSameMonth: {
      month: monthKey(lastYearMonthStart),
      label: monthLabel(lastYearMonthStart),
      billCount: Number(lastYearSummary.billCount) || 0,
      productCount: Number(lastYearSummary.productCount) || 0,
      amount: round2(lastYearSummary.amount),
      topProducts: statements.lastYearProducts.all(lastYearFrom, lastYearTo).map((row) => ({
        name: row.name,
        quantity: round2(row.quantity),
        orders: Number(row.orders) || 0,
        amount: round2(row.amount)
      }))
    },
    totals: {
      purchases: round2(totalPurchases),
      payments: round2(totalPayments),
      sales: round2(totalSales),
      creditNotes: round2(totalCreditNotes),
      purchaseCount: Number(purchases.count) || 0,
      paymentCount: Number(payments.count) || 0,
      salesCount: Number(sales.count) || 0,
      creditNoteCount: Number(creditNotes.count) || 0
    },
    currentMonth: {
      label: monthLabel(currentMonthStart),
      purchases: round2(currentPurchaseAmount),
      previousPurchases: round2(previousPurchaseAmount),
      payments: round2(currentPaymentAmount),
      previousPayments: round2(previousPaymentAmount),
      purchaseChangePercent: previousPurchaseAmount
        ? round2(((currentPurchaseAmount - previousPurchaseAmount) / previousPurchaseAmount) * 100)
        : null,
      paymentChangePercent: previousPaymentAmount
        ? round2(((currentPaymentAmount - previousPaymentAmount) / previousPaymentAmount) * 100)
        : null
    },
    averages: {
      monthlyPurchases: round2(totalPurchases / monthCount),
      monthlyPayments: round2(totalPayments / monthCount),
      monthlySales: round2(totalSales / monthCount),
      monthlyCreditNotes: round2(totalCreditNotes / monthCount),
      billValue: purchases.count ? round2(totalPurchases / purchases.count) : 0
    },
    ratios: {
      paymentCoverage: totalPurchases ? round2((totalPayments / totalPurchases) * 100) : 0,
      purchaseToSales: totalSales ? round2((totalPurchases / totalSales) * 100) : 0,
      supplierConcentration: totalPurchases && topSuppliers[0]
        ? round2((topSuppliers[0].amount / totalPurchases) * 100)
        : 0
    },
    bestMonth: {
      purchases: {
        label: bestPurchaseMonth.label,
        amount: round2(bestPurchaseMonth.purchases)
      },
      payments: {
        label: bestPaymentMonth.label,
        amount: round2(bestPaymentMonth.payments)
      }
    },
    monthlySeries: monthlySeries.map((month) => ({
      ...month,
      purchases: round2(month.purchases),
      payments: round2(month.payments),
      sales: round2(month.sales),
      creditNotes: round2(month.creditNotes)
    })),
    outstanding: {
      total: totalOutstanding,
      supplierCount: outstandingSuppliers.length,
      suppliers: outstandingSuppliers.slice(0, 6)
    },
    frequentProducts: statements.frequentProducts.all(from, to).map((row) => ({
      name: row.name,
      bills: Number(row.bills) || 0,
      quantity: round2(row.quantity)
    })),
    dataQuality: {
      duplicateGroups: duplicateGroups.length,
      duplicateExamples: duplicateGroups.slice(0, 3).map((names) => names.slice(0, 4)),
      missingBatch: Number(missingData.missingBatch) || 0,
      missingExpiry: Number(missingData.missingExpiry) || 0
    },
    topSuppliers,
    topProducts: statements.topProducts.all(from, to).map((row) => ({
      name: row.name,
      quantity: round2(row.quantity),
      amount: round2(row.amount)
    })),
    rediscover: statements.rediscover
      .all(lastYearFrom, lastYearTo, recentStart)
      .map((row) => ({
        name: row.name,
        quantity: round2(row.quantity),
        orders: Number(row.orders) || 0,
        lastPurchased: row.lastPurchased
      })),
    priceMoves,
    reorderCandidates: reorderCandidates.map((row) => ({
      name: row.name,
      stockOnHand: round2(row.stockOnHand),
      recentQuantity: round2(row.recentQuantity),
      averageMonthly: round2(row.averageMonthly)
    }))
  });
}

export function getMedicinePurchaseStats(req, res) {
  const searchText = String(req.query.search ?? '').trim();
  const search = searchText ? `%${searchText}%` : null;
  const requestedLimit = Number(req.query.limit);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(Math.trunc(requestedLimit), 1), 50)
    : 20;

  const medicines = statements.medicinePurchaseStats.all({ search, limit }).map((row) => ({
    productId: row.productId ?? null,
    name: row.name || 'Unnamed medicine',
    orderCount: Number(row.orderCount) || 0,
    lineCount: Number(row.lineCount) || 0,
    totalQuantity: round2(row.totalQuantity),
    freeQuantity: round2(row.freeQuantity),
    grossAmount: round2(row.grossAmount),
    totalAmount: round2(row.totalAmount),
    averageRate: round2(row.averageRate),
    lastOrderedDate: row.lastOrderedDate || ''
  }));

  res.json({
    search: searchText,
    count: medicines.length,
    medicines
  });
}

export function getMedicinePriceHistory(req, res) {
  const searchText = String(req.query.search ?? '').trim();
  const requestedProductId = Number(req.query.productId);
  const productId = Number.isSafeInteger(requestedProductId) && requestedProductId > 0
    ? requestedProductId
    : null;
  const name = String(req.query.name ?? '').trim();

  // No medicine selected yet: return matching medicines so the UI can show a
  // short picker instead of guessing which similarly named product was meant.
  if (!productId && !name) {
    const search = searchText ? `%${searchText}%` : null;

    const matches = search
      ? statements.priceHistoryMatches.all({ search }).map((row) => ({
          productId: row.productId ?? null,
          name: row.name || 'Unnamed medicine',
          lineCount: Number(row.lineCount) || 0,
          lastPurchased: row.lastPurchased || ''
        }))
      : [];

    res.json({ search: searchText, matches });
    return;
  }

  const rows = statements.priceHistoryPoints.all({
    productId,
    name: name || null
  });

  const points = rows.map((row) => {
    const unitPrice = round2(row.unitPrice);
    const gstPercentage = round2(row.gstPercentage);

    return {
      date: row.date || '',
      invoice: row.invoice || '',
      supplierName: row.supplierName || '',
      quantity: round2(row.quantity),
      unitPrice,
      gstPercentage,
      // Purchase rates are recorded before GST, so add the GST that applied on
      // that bill to make the chart comparable with the printed MRP.
      unitPriceWithGst: round2(unitPrice * (1 + gstPercentage / 100)),
      mrp: round2(row.mrp),
      lines: Number(row.lines) || 1
    };
  });

  const latest = points[points.length - 1] || null;
  const previous = points.length > 1 ? points[points.length - 2] : null;
  const unitPriceValues = points
    .map((point) => point.unitPriceWithGst)
    .filter((value) => Number.isFinite(value));
  const mrpValues = points
    .map((point) => point.mrp)
    .filter((value) => Number.isFinite(value));

  const summary = {
    pointCount: points.length,
    firstDate: points[0]?.date || '',
    lastDate: latest?.date || '',
    latestUnitPrice: latest?.unitPrice ?? 0,
    latestGstPercentage: latest?.gstPercentage ?? 0,
    latestUnitPriceWithGst: latest?.unitPriceWithGst ?? 0,
    latestMrp: latest?.mrp ?? 0,
    previousUnitPriceWithGst: previous?.unitPriceWithGst ?? null,
    unitPriceChangePercent:
      previous && previous.unitPriceWithGst > 0
        ? round2(
            ((latest.unitPriceWithGst - previous.unitPriceWithGst) /
              previous.unitPriceWithGst) *
              100
          )
        : null,
    minUnitPriceWithGst: unitPriceValues.length ? round2(Math.min(...unitPriceValues)) : 0,
    maxUnitPriceWithGst: unitPriceValues.length ? round2(Math.max(...unitPriceValues)) : 0,
    minMrp: mrpValues.length ? round2(Math.min(...mrpValues)) : 0,
    maxMrp: mrpValues.length ? round2(Math.max(...mrpValues)) : 0
  };

  res.json({
    medicine: {
      productId,
      name: name || rows[0]?.name || 'Medicine'
    },
    points,
    summary
  });
}

export { getInsights };
