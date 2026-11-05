/**
 * Salt catalogue and product-salt assignments.
 *
 * Salts belong to the canonical `products` row, so every batch of the same
 * medicine shares the same composition. Assignments are strictly optional:
 * an empty list clears them, and omitting the field leaves them untouched.
 */
import db from '../db/billPayment.js';
import { notFoundError, validationError } from '../utils/httpError.js';
import { cleanDisplay, normalizeKey } from '../utils/text.js';

export const MAX_SALTS_PER_PRODUCT = 12;

const statements = {
  saltById: db.prepare('SELECT * FROM salts WHERE id = ?'),
  saltByNormalized: db.prepare('SELECT * FROM salts WHERE normalizedName = ?'),
  insertSalt: db.prepare('INSERT INTO salts (name, normalizedName) VALUES (?, ?)'),
  productExists: db.prepare('SELECT id FROM products WHERE id = ?'),
  productSalts: db.prepare(`
    SELECT
      s.id AS id,
      s.id AS saltId,
      s.name,
      ps.strengthValue,
      ps.strengthUnit,
      ps.position
    FROM product_salts ps
    JOIN salts s ON s.id = ps.saltId
    WHERE ps.productId = ?
    ORDER BY ps.position ASC, s.name COLLATE NOCASE ASC
  `),
  deleteProductSalts: db.prepare('DELETE FROM product_salts WHERE productId = ?'),
  insertProductSalt: db.prepare(`
    INSERT INTO product_salts (productId, saltId, strengthValue, strengthUnit, position)
    VALUES (@productId, @saltId, @strengthValue, @strengthUnit, @position)
  `)
};

/** Find an existing salt by normalized name or create it. */
export function findOrCreateSalt(name) {
  const display = cleanDisplay(name);
  if (!display) throw validationError('Salt name is required');
  if (display.length > 120) throw validationError('Salt name is too long');

  const normalized = normalizeKey(display);
  const existing = statements.saltByNormalized.get(normalized);
  if (existing) return existing;

  const result = statements.insertSalt.run(display, normalized);
  return statements.saltById.get(result.lastInsertRowid);
}

/**
 * Search salts by name or alias. Results include how many products use each
 * salt so the most common ones rise to the top.
 */
export function listSalts(term = '', { limit = 20 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const search = term && String(term).trim() !== ''
    ? `%${String(term).trim()}%`
    : '%';

  return db.prepare(`
    SELECT
      s.id,
      s.name,
      (
        SELECT COUNT(*) FROM product_salts ps WHERE ps.saltId = s.id
      ) AS usageCount
    FROM salts s
    WHERE s.name LIKE @search
       OR s.normalizedName LIKE @search
       OR EXISTS (
         SELECT 1 FROM salt_aliases sa
         WHERE sa.saltId = s.id
           AND (sa.alias LIKE @search OR sa.normalizedAlias LIKE @search)
       )
    ORDER BY usageCount DESC, s.name COLLATE NOCASE ASC
    LIMIT ${safeLimit}
  `).all({ search });
}

export function getProductSalts(productId) {
  return statements.productSalts.all(Number(productId));
}

function normalizeStrength(value) {
  if (value === null || value === undefined || value === '') return null;

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw validationError('Salt strength must be zero or greater');
  }

  return Math.round(parsed * 10000) / 10000;
}

/**
 * undefined -> leave assignments untouched
 * null / []  -> clear assignments
 * array      -> replace assignments
 */
export function normalizeSaltAssignments(input) {
  if (input === undefined) return undefined;
  if (input === null) return [];
  if (!Array.isArray(input)) {
    throw validationError('Salts must be sent as a list');
  }

  const result = [];
  const seen = new Set();

  for (const raw of input) {
    if (raw === null || raw === undefined || raw === '') continue;

    const entry = typeof raw === 'string' ? { name: raw } : raw;

    if (typeof entry !== 'object' || Array.isArray(entry)) {
      throw validationError('Each salt must be an object or a name');
    }

    const name = cleanDisplay(entry.name);
    const rawId = Number(entry.saltId ?? entry.id);
    const saltId = Number.isSafeInteger(rawId) && rawId > 0 ? rawId : null;

    if (!saltId && !name) continue;

    const key = saltId ? `id:${saltId}` : `name:${normalizeKey(name)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (result.length >= MAX_SALTS_PER_PRODUCT) {
      throw validationError(`A medicine can have at most ${MAX_SALTS_PER_PRODUCT} salts`);
    }

    result.push({
      saltId,
      name,
      strengthValue: normalizeStrength(entry.strengthValue),
      strengthUnit: cleanDisplay(entry.strengthUnit).slice(0, 16) || null,
      position: result.length
    });
  }

  return result;
}

/**
 * Replace a product's salt composition. Undefined input is a no-op, which
 * lets a purchase or batch edit keep the existing composition when the user
 * never opens the salt editor.
 */
export function replaceProductSalts(productId, input) {
  const id = Number(productId);

  if (!Number.isSafeInteger(id) || id <= 0) {
    throw validationError('Invalid medicine id');
  }

  if (!statements.productExists.get(id)) {
    throw notFoundError('Medicine not found');
  }

  const assignments = normalizeSaltAssignments(input);
  if (assignments === undefined) return getProductSalts(id);

  const transaction = db.transaction(() => {
    statements.deleteProductSalts.run(id);

    for (const assignment of assignments) {
      let salt = assignment.saltId
        ? statements.saltById.get(assignment.saltId)
        : null;

      if (assignment.saltId && !salt) {
        throw validationError('Salt not found');
      }

      if (!salt) {
        salt = findOrCreateSalt(assignment.name);
      }

      statements.insertProductSalt.run({
        productId: id,
        saltId: salt.id,
        strengthValue: assignment.strengthValue,
        strengthUnit: assignment.strengthUnit,
        position: assignment.position
      });
    }
  });

  transaction();
  return getProductSalts(id);
}
