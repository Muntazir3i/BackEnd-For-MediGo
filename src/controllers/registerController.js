/**
 * Statutory prescription registers.
 *
 * Schedule H1 and Schedule X sales need a register that can be shown to the
 * drug inspector. The register reads invoice line snapshots so a later change
 * to the product's schedule cannot rewrite history.
 */
import db from '../db/billPayment.js';
import { validationError } from '../utils/httpError.js';

const VALID_SCHEDULES = new Set(['H', 'H1', 'X', 'all']);

const statements = {
  settings: db.prepare('SELECT pharmacistName FROM shop_settings WHERE id = 1'),
  register: db.prepare(`
    SELECT
      i.id AS invoiceId,
      i.invoiceNumber,
      i.createdAt,
      i.customerName AS patientName,
      i.customerPhone,
      i.customerAddress,
      i.prescriberName,
      i.prescriptionReference,
      i.prescriptionVerified,
      ii.id AS invoiceItemId,
      ii.nameSnapshot AS medicineName,
      ii.batchNumberSnapshot AS batchNumber,
      ii.expiryDateSnapshot AS expiryDate,
      ii.saleQuantity,
      ii.saleUnit,
      ii.quantity AS packQuantity,
      ii.unitsPerPack,
      ii.lineTotal,
      ii.drugScheduleSnapshot AS drugSchedule
    FROM invoices i
    JOIN invoice_items ii ON ii.invoiceId = i.id
    WHERE i.status <> 'voided'
      AND (
        (@allSchedules = 1 AND ii.drugScheduleSnapshot IN ('H', 'H1', 'X'))
        OR (@allSchedules = 0 AND ii.drugScheduleSnapshot = @schedule)
      )
      AND (@from IS NULL OR substr(i.createdAt, 1, 10) >= @from)
      AND (@to IS NULL OR substr(i.createdAt, 1, 10) <= @to)
    ORDER BY i.createdAt ASC, i.id ASC, ii.id ASC
    LIMIT 5000
  `)
};

export function getPrescriptionRegister(req, res) {
  const requested = String(req.query.schedule ?? 'H1').trim().toLowerCase();
  const schedule = requested === 'all' ? 'all' : requested.toUpperCase();

  if (!VALID_SCHEDULES.has(schedule)) {
    throw validationError('Schedule must be H, H1, X or all');
  }

  const from = String(req.query.from ?? '').trim() || null;
  const to = String(req.query.to ?? '').trim() || null;

  const rows = statements.register.all({
    schedule: schedule === 'all' ? null : schedule,
    allSchedules: schedule === 'all' ? 1 : 0,
    from,
    to
  }).map((row) => ({
    invoiceId: row.invoiceId,
    invoiceNumber: row.invoiceNumber,
    date: row.createdAt,
    patientName: row.patientName || '',
    customerPhone: row.customerPhone || '',
    customerAddress: row.customerAddress || '',
    prescriberName: row.prescriberName || '',
    prescriptionReference: row.prescriptionReference || '',
    prescriptionVerified: Number(row.prescriptionVerified) === 1,
    invoiceItemId: row.invoiceItemId,
    medicineName: row.medicineName || '',
    batchNumber: row.batchNumber || '',
    expiryDate: row.expiryDate || '',
    saleQuantity: Number(row.saleQuantity ?? row.packQuantity) || 0,
    saleUnit: row.saleUnit || 'PACK',
    packQuantity: Number(row.packQuantity) || 0,
    unitsPerPack: Number(row.unitsPerPack) || 1,
    lineTotal: Number(row.lineTotal) || 0,
    drugSchedule: row.drugSchedule || ''
  }));

  const summary = rows.reduce(
    (result, row) => {
      result.entries += 1;
      result.totalValue += row.lineTotal;
      result.patients.add(row.patientName || row.invoiceNumber);
      if (row.drugSchedule === 'H') result.h += 1;
      if (row.drugSchedule === 'H1') result.h1 += 1;
      if (row.drugSchedule === 'X') result.x += 1;
      return result;
    },
    { entries: 0, totalValue: 0, h: 0, h1: 0, x: 0, patients: new Set() }
  );

  const pharmacistName = statements.settings.get()?.pharmacistName || '';

  res.json({
    schedule,
    from,
    to,
    pharmacistName,
    count: rows.length,
    summary: {
      entries: summary.entries,
      totalValue: Math.round((summary.totalValue + Number.EPSILON) * 100) / 100,
      patients: summary.patients.size,
      h: summary.h,
      h1: summary.h1,
      x: summary.x
    },
    rows
  });
}
