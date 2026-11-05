/**
 * Inventory controller.
 *
 * Rows are batch-level inventory_items joined to the canonical products table.
 * Quantity changes are written through stock_movements; deleting a row is a
 * soft deactivate so historical purchase/sales records keep their references.
 */
import {
  adjustInventoryItem,
  deactivateInventoryItem,
  fetchInventoryById,
  listInventory,
  updateInventoryItem
} from '../services/inventoryService.js';

export const MEDICINE_PAGE_SIZE = 100;

export function fetchAllMedicines() {
  return listInventory({ limit: MEDICINE_PAGE_SIZE });
}

export function fetchMedicineById(id) {
  return fetchInventoryById(id);
}

export function updateMedicineById(id, data = {}) {
  const medicine = updateInventoryItem(id, data);
  return { updated: Boolean(medicine), medicine };
}

export function deleteMedicineById(id) {
  return deactivateInventoryItem(id);
}

export function adjustStockById(id, data = {}) {
  const medicine = adjustInventoryItem(id, data);
  return { adjusted: true, medicine };
}
