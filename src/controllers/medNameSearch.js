/**
 * Controller for handling medicine search operations using SQLite.
 *
 * Searches medicines by name or batch number using partial matching and
 * limits the results so the inventory screen stays responsive.
 */
import db from "../db/billPayment.js";

const SEARCH_RESULT_LIMIT = 100;

// 1. Pre-compile statements for better performance
// This avoids parsing the SQL string on every function call.
const statements = {
    fetchSearchMed: db.prepare(`
        SELECT *
        FROM bill_products
        WHERE name LIKE @term
           OR batchNumber LIKE @term
        ORDER BY id DESC
        LIMIT ${SEARCH_RESULT_LIMIT}
    `)
};

export function fetchSearchMed(name) {
    // 2. Use partial matching so both a medicine name and a batch number
    // can be searched from the same input.
    const searchTerm = name && name.trim() !== ''
        ? `%${name.trim()}%`
        : '%';

    return statements.fetchSearchMed.all({ term: searchTerm });
}
