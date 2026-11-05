/**
 * Medicine search.
 *
 * Searches the canonical product name, its salt composition, or a batch
 * number across live inventory. Zero-stock batches are included so the UI can
 * show "out of stock" instead of making the medicine disappear.
 */
import { searchInventory } from '../services/inventoryService.js';

const SEARCH_RESULT_LIMIT = 100;

export function fetchSearchMed(name) {
  return searchInventory(name, {
    limit: SEARCH_RESULT_LIMIT,
    includeInactive: false
  });
}
