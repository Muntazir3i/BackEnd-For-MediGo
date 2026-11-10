/**
 * Shop settings controller.
 *
 * The table has exactly one row, so reads and writes always target id = 1.
 * Values are normalised here rather than in the route so the API and any
 * future caller share the same rules.
 */
import db from '../db/billPayment.js';
import { validationError } from '../utils/httpError.js';

const MAX_LENGTHS = {
  shopName: 120,
  drugLicenceNumber: 60,
  phone: 40,
  address: 240,
  gstin: 30,
  email: 120,
  pharmacistName: 120,
  invoiceFooter: 400
};

const FIELD_LABELS = {
  shopName: 'Shop name',
  drugLicenceNumber: 'Drug licence number',
  phone: 'Phone number',
  address: 'Address',
  gstin: 'GSTIN',
  email: 'Email address',
  pharmacistName: 'Pharmacist / signature label',
  invoiceFooter: 'Invoice footer note'
};

const statements = {
  select: db.prepare('SELECT * FROM shop_settings WHERE id = 1'),
  insert: db.prepare(`
    INSERT INTO shop_settings (
      id, shopName, drugLicenceNumber, phone, address, gstin, email,
      pharmacistName, invoiceFooter
    ) VALUES (
      1, @shopName, @drugLicenceNumber, @phone, @address, @gstin, @email,
      @pharmacistName, @invoiceFooter
    )
  `),
  update: db.prepare(`
    UPDATE shop_settings
    SET shopName = @shopName,
        drugLicenceNumber = @drugLicenceNumber,
        phone = @phone,
        address = @address,
        gstin = @gstin,
        email = @email,
        pharmacistName = @pharmacistName,
        invoiceFooter = @invoiceFooter,
        updatedAt = datetime('now')
    WHERE id = 1
  `)
};

const DEFAULTS = {
  shopName: '',
  drugLicenceNumber: '',
  phone: '',
  address: '',
  gstin: '',
  email: '',
  pharmacistName: '',
  invoiceFooter: ''
};

function cleanText(value, field) {
  if (value === undefined || value === null) return '';
  const text = String(value).trim();
  const max = MAX_LENGTHS[field];
  if (max && text.length > max) {
    throw validationError(`${FIELD_LABELS[field] || field} must be ${max} characters or fewer`);
  }
  return text;
}

function mapSettings(row = DEFAULTS) {
  return {
    id: 1,
    shopName: row.shopName || '',
    drugLicenceNumber: row.drugLicenceNumber || '',
    phone: row.phone || '',
    address: row.address || '',
    gstin: row.gstin || '',
    email: row.email || '',
    pharmacistName: row.pharmacistName || '',
    invoiceFooter: row.invoiceFooter || '',
    updatedAt: row.updatedAt || null
  };
}

export function getShopSettings() {
  let row = statements.select.get();

  if (!row) {
    statements.insert.run(DEFAULTS);
    row = statements.select.get();
  }

  return mapSettings(row);
}

export function updateShopSettings(payload = {}) {
  const current = getShopSettings();

  // Only fields present in the request are changed, so a partial update from
  // another screen cannot accidentally wipe the rest of the settings.
  const next = {
    shopName: payload.shopName === undefined
      ? current.shopName
      : cleanText(payload.shopName, 'shopName'),
    drugLicenceNumber: payload.drugLicenceNumber === undefined
      ? current.drugLicenceNumber
      : cleanText(payload.drugLicenceNumber, 'drugLicenceNumber'),
    phone: payload.phone === undefined ? current.phone : cleanText(payload.phone, 'phone'),
    address: payload.address === undefined ? current.address : cleanText(payload.address, 'address'),
    gstin: payload.gstin === undefined ? current.gstin : cleanText(payload.gstin, 'gstin'),
    email: payload.email === undefined ? current.email : cleanText(payload.email, 'email'),
    pharmacistName: payload.pharmacistName === undefined
      ? current.pharmacistName
      : cleanText(payload.pharmacistName, 'pharmacistName'),
    invoiceFooter: payload.invoiceFooter === undefined
      ? current.invoiceFooter
      : cleanText(payload.invoiceFooter, 'invoiceFooter')
  };

  if (!next.shopName) {
    throw validationError('Shop name is required');
  }

  if (next.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next.email)) {
    throw validationError('Enter a valid email address');
  }

  statements.update.run(next);
  return getShopSettings();
}
