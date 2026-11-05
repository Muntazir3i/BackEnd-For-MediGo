/**
 * Shared inventory helpers.
 *
 * The tables in this module are the source of truth after the inventory /
 * invoice split:
 *   products        -> canonical medicine catalogue (never hard-deleted)
 *   inventory_items -> live stock, one row per product + batch
 *   stock_movements -> auditable ledger for every quantity change
 *
 * Purchase and sales line items are snapshots and must never be used to read
 * live stock.
 */
import db from '../db/billPayment.js';
import { conflictError, notFoundError, validationError } from '../utils/httpError.js';
import { cleanDisplay, normalizeKey } from '../utils/text.js';
import { replaceProductSalts } from './saltService.js';

export { cleanDisplay, normalizeKey };

export const INVENTORY_SELECT = `
  SELECT
    i.id,
    i.productId,
    p.name,
    COALESCE(p.category, '') AS category,
    i.batchNumber,
    i.expiryDate,
    i.quantity AS stock,
    i.purchasePrice AS unitPrice,
    i.mrp,
    i.sellingPrice,
    i.discount,
    i.gstPercentage,
    i.supplier,
    i.receivedAt,
    i.isActive,
    p.isActive AS productIsActive,
    i.createdAt,
    i.updatedAt
  FROM inventory_items i
  JOIN products p ON p.id = i.productId
`;

const statements = {
  productByNormalized: db.prepare('SELECT * FROM products WHERE normalizedName = ?'),
  productById: db.prepare('SELECT * FROM products WHERE id = ?'),
  insertProduct: db.prepare(`
    INSERT INTO products (
      name, normalizedName, category, defaultPurchasePrice, defaultMrp,
      defaultSellingPrice, discount, gstPercentage, isActive
    ) VALUES (
      @name, @normalizedName, @category, @defaultPurchasePrice, @defaultMrp,
      @defaultSellingPrice, @discount, @gstPercentage, 1
    )
  `),
  updateProduct: db.prepare(`
    UPDATE products
    SET name = @name,
        category = CASE WHEN @category IS NULL OR @category = '' THEN category ELSE @category END,
        defaultPurchasePrice = COALESCE(@defaultPurchasePrice, defaultPurchasePrice),
        defaultMrp = COALESCE(@defaultMrp, defaultMrp),
        defaultSellingPrice = COALESCE(@defaultSellingPrice, defaultSellingPrice),
        discount = COALESCE(@discount, discount),
        gstPercentage = COALESCE(@gstPercentage, gstPercentage),
        isActive = 1,
        updatedAt = datetime('now')
    WHERE id = @id
  `),
  renameProduct: db.prepare(`
    UPDATE products
    SET name = @name, normalizedName = @normalizedName, updatedAt = datetime('now')
    WHERE id = @id
  `),
  inventoryByProductBatch: db.prepare(`
    SELECT * FROM inventory_items WHERE productId = ? AND batchKey = ?
  `),
  inventoryById: db.prepare('SELECT * FROM inventory_items WHERE id = ?'),
  insertInventory: db.prepare(`
    INSERT INTO inventory_items (
      productId, batchNumber, batchKey, expiryDate, quantity, purchasePrice,
      mrp, sellingPrice, discount, gstPercentage, supplier, supplierId,
      receivedAt, isActive
    ) VALUES (
      @productId, @batchNumber, @batchKey, @expiryDate, @quantity, @purchasePrice,
      @mrp, @sellingPrice, @discount, @gstPercentage, @supplier, @supplierId,
      @receivedAt, 1
    )
  `),
  updateInventoryMetadata: db.prepare(`
    UPDATE inventory_items
    SET batchNumber = @batchNumber,
        batchKey = @batchKey,
        expiryDate = @expiryDate,
        purchasePrice = COALESCE(@purchasePrice, purchasePrice),
        mrp = COALESCE(@mrp, mrp),
        sellingPrice = COALESCE(@sellingPrice, sellingPrice),
        discount = COALESCE(@discount, discount),
        gstPercentage = COALESCE(@gstPercentage, gstPercentage),
        supplier = CASE WHEN @supplier IS NULL THEN supplier ELSE @supplier END,
        receivedAt = COALESCE(@receivedAt, receivedAt),
        isActive = 1,
        updatedAt = datetime('now')
    WHERE id = @id
  `),
  updateQuantity: db.prepare(`
    UPDATE inventory_items
    SET quantity = quantity + @delta, updatedAt = datetime('now')
    WHERE id = @id AND quantity + @delta >= 0
  `),
  deactivateInventory: db.prepare(`
    UPDATE inventory_items SET isActive = 0, updatedAt = datetime('now') WHERE id = ?
  `),
  insertMovement: db.prepare(`
    INSERT INTO stock_movements (
      inventoryItemId, productId, type, quantityDelta, quantityBefore,
      quantityAfter, referenceType, referenceId, note
    ) VALUES (
      @inventoryItemId, @productId, @type, @quantityDelta, @quantityBefore,
      @quantityAfter, @referenceType, @referenceId, @note
    )
  `)
};

export function toNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function toNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

/**
 * Find or create the canonical catalogue row for a medicine name.
 * Product rows are never deleted; discontinued products are deactivated.
 */
export function resolveProduct(data = {}) {
  const name = cleanDisplay(data.name);
  if (!name) throw validationError('Medicine name is required');

  const normalizedName = normalizeKey(name);
  const category = cleanDisplay(data.category);
  const purchasePrice = toNumberOrNull(data.unitPrice ?? data.purchasePrice);
  const mrp = toNumberOrNull(data.mrp);
  const sellingPrice = toNumberOrNull(data.sellingPrice) ?? mrp;
  const discount = toNumberOrNull(data.discount);
  const gstPercentage = toNumberOrNull(data.gstPercentage);

  let product = statements.productByNormalized.get(normalizedName);

  if (!product) {
    const result = statements.insertProduct.run({
      name,
      normalizedName,
      category,
      defaultPurchasePrice: purchasePrice ?? 0,
      defaultMrp: mrp ?? 0,
      defaultSellingPrice: sellingPrice ?? 0,
      discount: discount ?? 0,
      gstPercentage: gstPercentage ?? 0
    });
    product = statements.productById.get(result.lastInsertRowid);
  } else {
    statements.updateProduct.run({
      id: product.id,
      name,
      category,
      defaultPurchasePrice: purchasePrice,
      defaultMrp: mrp,
      defaultSellingPrice: sellingPrice,
      discount,
      gstPercentage
    });
    product = statements.productById.get(product.id);
  }

  return product;
}

/**
 * Find or create a batch row for a product and refresh its latest metadata.
 * A batch at quantity 0 is intentionally kept - it stays visible in inventory.
 */
export function resolveInventoryItem(productId, data = {}) {
  const product = statements.productById.get(productId);
  if (!product) throw notFoundError('Medicine not found');

  const batchNumber = cleanDisplay(data.batchNumber);
  const batchKey = normalizeKey(batchNumber);
  const hasExpiry = Object.prototype.hasOwnProperty.call(data, 'expiryDate');
  const expiryDate = hasExpiry ? cleanDisplay(data.expiryDate) : '';
  const purchasePrice = toNumberOrNull(data.unitPrice ?? data.purchasePrice);
  const mrp = toNumberOrNull(data.mrp);
  const sellingPrice = toNumberOrNull(data.sellingPrice) ?? mrp;
  const discount = toNumberOrNull(data.discount);
  const gstPercentage = toNumberOrNull(data.gstPercentage);
  const supplier = data.supplier === undefined ? null : cleanDisplay(data.supplier);
  const receivedAt = data.receivedAt === undefined ? null : cleanDisplay(data.receivedAt);

  let item = statements.inventoryByProductBatch.get(productId, batchKey);

  if (!item) {
    const result = statements.insertInventory.run({
      productId,
      batchNumber,
      batchKey,
      expiryDate,
      quantity: 0,
      purchasePrice: purchasePrice ?? 0,
      mrp: mrp ?? 0,
      sellingPrice: sellingPrice ?? 0,
      discount: discount ?? 0,
      gstPercentage: gstPercentage ?? 0,
      supplier,
      supplierId: toNumberOrNull(data.supplierId),
      receivedAt
    });
    item = statements.inventoryById.get(result.lastInsertRowid);
  } else {
    statements.updateInventoryMetadata.run({
      id: item.id,
      batchNumber,
      batchKey,
      expiryDate,
      purchasePrice,
      mrp,
      sellingPrice,
      discount,
      gstPercentage,
      supplier,
      receivedAt
    });
    item = statements.inventoryById.get(item.id);
  }

  return item;
}

/**
 * Apply a signed quantity change and write an audit movement.
 * Conditional UPDATE + CHECK constraint make negative stock impossible.
 */
export function applyStockMovement({
  inventoryItemId,
  delta,
  type,
  referenceType = null,
  referenceId = null,
  note = null
}) {
  const itemId = Number(inventoryItemId);
  const change = Number(delta);

  if (!Number.isSafeInteger(itemId) || itemId <= 0) {
    throw validationError('Invalid inventory item');
  }

  if (!Number.isFinite(change)) {
    throw validationError('Invalid stock quantity');
  }

  const item = statements.inventoryById.get(itemId);
  if (!item) throw notFoundError('Inventory item not found');

  if (change === 0) return item;

  const result = statements.updateQuantity.run({ id: itemId, delta: change });

  if (result.changes === 0) {
    const current = statements.inventoryById.get(itemId);
    throw conflictError(
      `Not enough stock for this medicine. Only ${current?.quantity ?? 0} unit(s) remain.`,
      { inventoryItemId: itemId, available: current?.quantity ?? 0 }
    );
  }

  const updated = statements.inventoryById.get(itemId);

  statements.insertMovement.run({
    inventoryItemId: itemId,
    productId: updated.productId,
    type,
    quantityDelta: change,
    quantityBefore: updated.quantity - change,
    quantityAfter: updated.quantity,
    referenceType,
    referenceId,
    note
  });

  return updated;
}

export function getInventoryItem(id) {
  return statements.inventoryById.get(Number(id));
}

export function getSaltsForProductIds(productIds = []) {
  const ids = [...new Set(productIds.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))];
  const result = new Map();
  if (ids.length === 0) return result;

  const placeholders = ids.map(() => '?').join(', ');
  const rows = db.prepare(`
    SELECT
      ps.productId,
      s.id AS saltId,
      s.name,
      ps.strengthValue,
      ps.strengthUnit,
      ps.position
    FROM product_salts ps
    JOIN salts s ON s.id = ps.saltId
    WHERE ps.productId IN (${placeholders})
    ORDER BY ps.productId, ps.position, s.name
  `).all(...ids);

  for (const row of rows) {
    if (!result.has(row.productId)) result.set(row.productId, []);
    result.get(row.productId).push({
      id: row.saltId,
      name: row.name,
      strengthValue: row.strengthValue,
      strengthUnit: row.strengthUnit
    });
  }

  return result;
}

export function formatSaltSummary(salts = []) {
  return salts
    .map((salt) => {
      const strength = salt.strengthValue === null || salt.strengthValue === undefined
        ? ''
        : ` ${salt.strengthValue}${salt.strengthUnit ? ` ${salt.strengthUnit}` : ''}`;
      return `${salt.name}${strength}`;
    })
    .join(' + ');
}

export function attachSalts(rows = []) {
  const saltsByProduct = getSaltsForProductIds(rows.map((row) => row.productId));

  return rows.map((row) => {
    const salts = saltsByProduct.get(row.productId) ?? [];
    return {
      ...row,
      inventoryItemId: row.id,
      salts,
      saltSummary: formatSaltSummary(salts)
    };
  });
}

export function fetchInventoryById(id) {
  const row = db.prepare(`${INVENTORY_SELECT} WHERE i.id = ?`).get(Number(id));
  if (!row) return null;
  return attachSalts([row])[0];
}

export function searchInventory(term = '', { limit = 100, includeInactive = false, inStockOnly = false } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const searchTerm = term && String(term).trim() !== ''
    ? `%${String(term).trim()}%`
    : '%';

  const where = [
    includeInactive ? '1 = 1' : 'p.isActive = 1 AND i.isActive = 1',
    inStockOnly ? 'i.quantity > 0' : '1 = 1'
  ];

  const rows = db.prepare(`
    ${INVENTORY_SELECT}
    WHERE ${where.join(' AND ')}
      AND (
        p.name LIKE @term
        OR i.batchNumber LIKE @term
        OR EXISTS (
          SELECT 1
          FROM product_salts ps
          JOIN salts s ON s.id = ps.saltId
          LEFT JOIN salt_aliases sa ON sa.saltId = s.id
          WHERE ps.productId = p.id
            AND (s.name LIKE @term OR s.normalizedName LIKE @term OR sa.alias LIKE @term OR sa.normalizedAlias LIKE @term)
        )
      )
    ORDER BY i.id DESC
    LIMIT ${safeLimit}
  `).all({ term: searchTerm });

  return attachSalts(rows);
}

export function listInventory({ limit = 100, offset = 0 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const safeOffset = Math.max(Number(offset) || 0, 0);

  const rows = db.prepare(`
    ${INVENTORY_SELECT}
    WHERE p.isActive = 1 AND i.isActive = 1
    ORDER BY i.id DESC
    LIMIT ${safeLimit} OFFSET ${safeOffset}
  `).all();

  return attachSalts(rows);
}

/**
 * Update inventory metadata (never a blind stock overwrite) and optionally
 * apply an audited quantity adjustment when the caller sends a new stock value.
 */
export function updateInventoryItem(id, data = {}) {
  const itemId = Number(id);
  if (!Number.isSafeInteger(itemId) || itemId <= 0) {
    throw validationError('Invalid medicine id');
  }

  const item = statements.inventoryById.get(itemId);
  if (!item) throw notFoundError('Medicine not found');

  const product = statements.productById.get(item.productId);
  if (!product) throw notFoundError('Medicine not found');

  const productId = product.id;

  if (data.name !== undefined) {
    const name = cleanDisplay(data.name);
    if (!name) throw validationError('Medicine name is required');

    const nextNormalized = normalizeKey(name);
    const duplicate = statements.productByNormalized.get(nextNormalized);

    if (duplicate && duplicate.id !== product.id) {
      throw conflictError('Another medicine already uses that name.');
    }

    if (nextNormalized !== product.normalizedName) {
      statements.renameProduct.run({
        id: product.id,
        name,
        normalizedName: nextNormalized
      });
    } else if (name !== product.name) {
      statements.renameProduct.run({
        id: product.id,
        name,
        normalizedName: nextNormalized
      });
    }
  }

  const nextBatchNumber = data.batchNumber !== undefined
    ? cleanDisplay(data.batchNumber)
    : item.batchNumber;
  const nextBatchKey = normalizeKey(nextBatchNumber);

  if (nextBatchKey !== item.batchKey) {
    const collision = statements.inventoryByProductBatch.get(productId, nextBatchKey);
    if (collision && collision.id !== itemId) {
      throw conflictError('Another batch with that number already exists for this medicine.');
    }
  }

  statements.updateInventoryMetadata.run({
    id: itemId,
    batchNumber: nextBatchNumber,
    batchKey: nextBatchKey,
    expiryDate: data.expiryDate !== undefined ? cleanDisplay(data.expiryDate) : item.expiryDate,
    purchasePrice: toNumberOrNull(data.unitPrice ?? data.purchasePrice),
    mrp: toNumberOrNull(data.mrp),
    sellingPrice: toNumberOrNull(data.sellingPrice),
    discount: toNumberOrNull(data.discount),
    gstPercentage: toNumberOrNull(data.gstPercentage),
    supplier: data.supplier !== undefined ? cleanDisplay(data.supplier) : item.supplier,
    receivedAt: null
  });

  if (data.category !== undefined) {
    db.prepare(`
      UPDATE products
      SET category = @category, updatedAt = datetime('now')
      WHERE id = @id
    `).run({ id: productId, category: cleanDisplay(data.category) });
  }

  if (data.stock !== undefined && data.stock !== null && data.stock !== '') {
    const nextQuantity = Number(data.stock);
    if (!Number.isFinite(nextQuantity) || nextQuantity < 0) {
      throw validationError('Stock quantity must be zero or greater');
    }

    const current = statements.inventoryById.get(itemId);
    const delta = round2(nextQuantity - current.quantity);

    if (delta !== 0) {
      applyStockMovement({
        inventoryItemId: itemId,
        delta,
        type: 'adjustment',
        referenceType: 'inventory_edit',
        referenceId: itemId,
        note: 'Stock adjusted from inventory edit'
      });
    }
  }

  // Salt composition is optional. Omitting the key preserves it; sending an
  // empty list clears it.
  if (Object.prototype.hasOwnProperty.call(data, 'salts')) {
    replaceProductSalts(productId, data.salts);
  }

  return fetchInventoryById(itemId);
}

export function adjustInventoryItem(id, { delta, quantity, reason } = {}) {
  const itemId = Number(id);
  if (!Number.isSafeInteger(itemId) || itemId <= 0) {
    throw validationError('Invalid medicine id');
  }

  const item = statements.inventoryById.get(itemId);
  if (!item) throw notFoundError('Medicine not found');

  let change = toNumberOrNull(delta);

  if (change === null && quantity !== undefined && quantity !== null && quantity !== '') {
    const nextQuantity = Number(quantity);
    if (!Number.isFinite(nextQuantity) || nextQuantity < 0) {
      throw validationError('Stock quantity must be zero or greater');
    }
    change = round2(nextQuantity - item.quantity);
  }

  if (change === null) {
    throw validationError('Provide a stock delta or a new quantity');
  }

  if (change !== 0) {
    applyStockMovement({
      inventoryItemId: itemId,
      delta: change,
      type: 'adjustment',
      referenceType: 'manual_adjustment',
      referenceId: itemId,
      note: cleanDisplay(reason) || 'Manual stock adjustment'
    });
  }

  return fetchInventoryById(itemId);
}

export function deactivateInventoryItem(id) {
  const itemId = Number(id);
  if (!Number.isSafeInteger(itemId) || itemId <= 0) {
    throw validationError('Invalid medicine id');
  }

  const result = statements.deactivateInventory.run(itemId);
  return { deleted: result.changes > 0, inventoryItemId: itemId };
}
