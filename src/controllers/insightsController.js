/**
 * Hidden business insights.
 *
 * The page is intentionally not linked from the sidebar. It is reachable only
 * through the command palette.
 */
import db from '../db/billPayment.js';

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

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
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
      }))
  });
}

export { getInsights };
