import db from "../db/billPayment.js";

// 1. Pre-compile statements for better performance
// This avoids parsing the SQL string on every function call.
const statements = {
    fetchSearchMed: db.prepare(`
        SELECT *
        FROM bill_products
        WHERE name LIKE @name
        ORDER BY id DESC
        LIMIT 3;
    `)
};

export function fetchSearchMed(name) {
    // 2. Use named parameters with a fallback and wildcard matching
    // Fallback to empty string if name is undefined or null, though LIKE '%' would match all
    // But since it's a search, returning matched strings is fine.
    const searchTerm = name ? `${name}%` : '%';
    return statements.fetchSearchMed.all({ name: searchTerm });
}
