# MediGo Backend

REST API and data layer for **MediGo**, a medical shop ERP built for local-first pharmacy operations. It manages purchases, batch-level inventory, sales invoices, supplier payments, ledgers, expiry records, credit notes, business insights, and supplier bill image extraction.

The backend is designed around **SQLite**, transactional stock movements, and immutable historical snapshots, so purchase and sales history remains auditable even when inventory changes.

- **Frontend repository:** https://github.com/Muntazir3i/MediGo-
- **Backend repository:** https://github.com/Muntazir3i/BackEnd-For-MediGo

## Highlights

- Batch-level inventory with an auditable stock-movement ledger
- Purchase bills with free quantity, editing, and safe voiding
- Sales invoices with exact stock restoration on deletion
- Supplier directory, payments, and statement-ready ledger data
- Expiry register and expiry ledger
- Credit notes with header and line-item support
- Business insights for purchases, products, payables, and trends
- Optional supplier bill image extraction using Google Gemini
- SQLite WAL mode for responsive local reads and safe concurrent writes

## Architecture

The backend follows a layered structure:

- **Routes** expose HTTP endpoints and map them to controllers
- **Controllers** validate requests and orchestrate transactions
- **Services** contain shared business logic for inventory, salts, and sales invoices
- **Setup modules** create and migrate the SQLite schema at startup
- **Database layer** owns the SQLite connection and pragmas

### Stock model

Inventory is not stored directly on purchase or invoice lines. It is split into:

- `products` — canonical medicine catalogue
- `inventory_items` — live stock per product and batch
- `stock_movements` — auditable ledger of every quantity change
- `purchase_items` / `invoice_items` — historical line snapshots

This separation allows purchase edits and invoice deletions to apply explicit stock deltas without rewriting history.

### Transaction rules

- Purchase quantities and free quantities increase stock; free units are not charged.
- Editing a purchase bill applies the difference between old and new quantities.
- Voiding a purchase bill is only allowed while all received units remain in stock.
- Sales invoices deduct stock at creation time.
- Deleting a sales invoice restores the exact batch quantities and keeps an audit record.
- Credit notes reduce the supplier ledger balance.

## Tech stack

| Area | Technology |
| --- | --- |
| Runtime | Node.js 20+ (tested on Node 24) |
| HTTP | Express 5 |
| Database | SQLite via `better-sqlite3` |
| Configuration | `dotenv` |
| Bill extraction | `@google/genai` |
| Module system | ES Modules |

## Project structure

```text
shopbackend/
├── src/
│   ├── controllers/      # Request handlers and transaction orchestration
│   ├── db/               # SQLite connections
│   ├── routes/           # Express routers
│   ├── services/         # Inventory, sales, salt and stock logic
│   ├── setup/            # Schema creation and additive migrations
│   ├── utils/            # Shared HTTP and text utilities
│   └── index.js          # Application entry point
├── scripts/
│   ├── migrateInventorySplit.js
│   └── dedupeInventory.js
├── backups/              # Local database backups (not committed)
├── billsNpayment.db      # Main SQLite database (created on first run)
├── supplier.db           # Supplier directory database
├── .env
└── package.json
```

## Getting started

### Prerequisites

- Node.js 20 or newer
- npm
- A Google AI Studio API key if supplier bill image extraction is required

### Install

```bash
git clone https://github.com/Muntazir3i/BackEnd-For-MediGo.git
cd BackEnd-For-MediGo
npm install
```

### Configure

Create a `.env` file in the project root:

```env
DB_PATH=billsNpayment.db
GEMINI_API_KEY=your-google-ai-studio-key
GEMINI_MODEL=gemini-3.6-flash
```

`GEMINI_API_KEY` is only required for bill image extraction. `GEMINI_MODEL` is optional.

### Run

```bash
npm start
```

The API listens on:

```text
http://localhost:8008
```

The port is configured in `src/index.js`.

## Environment variables

| Variable | Default | Required | Purpose |
| --- | --- | --- | --- |
| `DB_PATH` | `billsNpayment.db` | No | Main SQLite database path |
| `GEMINI_API_KEY` | — | For bill extraction | Google Gemini API key |
| `GEMINI_MODEL` | `gemini-3.6-flash` | No | Gemini model used for bill extraction |

> `supplier.db` is currently a fixed file in the project root for the supplier directory.

## Available scripts

| Command | Description |
| --- | --- |
| `npm start` | Start the API server |
| `npm run migrate:inventory` | Migrate legacy purchase data into the inventory/purchase schema |
| `npm run dedupe:inventory` | Archive or remove older duplicate inventory batches |

`dedupeInventory.js` supports `--dry-run`, `--keep=N`, and `--hard` flags. See the script header for details.

There is currently no automated test suite configured.

## API reference

Base URL: `http://localhost:8008`

### Bill image extraction

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/api/bills/extract` | Extract a supplier bill image with Gemini |

### Suppliers

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/supplier/suppliers` | List suppliers |
| `POST` | `/api/supplier/suppliers` | Create a supplier |

### Purchase bills

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/sqlbills/bills` | Paginated purchase bills with filters |
| `POST` | `/api/sqlbills/bills` | Create a purchase bill |
| `PUT` | `/api/sqlbills/bills/:id` | Edit a purchase bill |
| `DELETE` | `/api/sqlbills/bills/:id` | Void a purchase bill and reverse stock |
| `GET` | `/api/sqlbills/bills/suppliers` | Supplier summaries for purchase history |

### Supplier ledger and payments

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/sqlbillpayment/summary` | Supplier balance and totals |
| `GET` | `/api/sqlbillpayment/transactions` | Cursor-paginated supplier transactions |
| `GET` | `/api/sqlbillpayment/all-data` | Full supplier ledger for statement PDFs |
| `GET` | `/api/sqlpayment/payments` | List payments |
| `POST` | `/api/sqlpayment/payments` | Create a payment |
| `PUT` | `/api/sqlpayment/payments/:id` | Update a payment |
| `DELETE` | `/api/sqlpayment/payments/:id` | Delete a payment |
| `GET` | `/api/sqlpayment/payments/loadMore/:lastId` | Paginated payment loading |
| `GET` | `/api/sqlpayment/payments/date/:date` | Payments by date |

### Inventory and medicines

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/sqlmedicines/medicines` | List inventory batches |
| `GET` | `/api/sqlmedicines/medicines/:id` | Fetch a medicine batch |
| `PUT` | `/api/sqlmedicines/medicines/:id` | Update medicine/batch metadata |
| `DELETE` | `/api/sqlmedicines/medicines/:id` | Deactivate a medicine batch |
| `POST` | `/api/sqlmedicines/medicines/:id/adjust` | Audited stock adjustment |
| `GET` | `/api/sqlmedicines/low-stock` | Low-stock products |
| `GET` | `/api/sqlmedicines/out-of-stock` | Out-of-stock products |
| `GET` | `/api/sqlmedicines/expiry-stock` | Expiring inventory |
| `GET` | `/api/sqlmedicines/salts` | Search salts |
| `POST` | `/api/sqlmedicines/salts` | Create a salt |
| `GET` | `/api/searchMedicine/medicines/search/:name` | Medicine name search |

### Sales invoices

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/api/sales/invoices` | Create a sales invoice |
| `GET` | `/api/sales/invoices` | Search/list sales invoices |
| `GET` | `/api/sales/invoices/:id` | Fetch an invoice with line snapshots |
| `DELETE` | `/api/sales/invoices/:id` | Delete an invoice and restore stock |
| `POST` | `/api/sales/invoices/:id/void` | Void an invoice |

Compatibility invoice routes are also available under `/api/invoice`.

### Expiry register

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/api/expiry/add-expiry` | Create an expiry/removal record |
| `GET` | `/api/expiry/all-expiry` | List expiry records |
| `GET` | `/api/expiry/find-exp/:name` | Expiry records for a supplier |
| `DELETE` | `/api/expiry/:id` | Delete an expiry record |

### Credit notes

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/credit-notes` | List credit notes |
| `GET` | `/api/credit-notes/:id` | Fetch a credit note |
| `POST` | `/api/credit-notes` | Create a credit note |
| `PUT` | `/api/credit-notes/:id` | Update a credit note |
| `DELETE` | `/api/credit-notes/:id` | Delete a credit note |

### Insights

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/insights` | Purchase trends, payables, products and business metrics |

## Supplier bill image extraction

`POST /api/bills/extract`

Request:

```json
{
  "base64": "<image base64>",
  "mimeType": "image/jpeg"
}
```

Accepted image types: JPG, PNG, WebP. The frontend limits uploads to 8 MB; the backend accepts up to 14 MB decoded.

Response:

```json
{
  "invoice": "",
  "date": "",
  "supplierName": "",
  "supplierDrugLn": "",
  "supplierContact": "",
  "products": [
    {
      "name": "",
      "batchNumber": "",
      "expiryDate": "",
      "stock": 0,
      "free": 0,
      "unitPrice": 0,
      "mrp": 0,
      "discount": 0,
      "gstPercentage": 0
    }
  ]
}
```

Extraction requires `GEMINI_API_KEY` and an internet connection. Dates are returned as `YYYY-MM-DD`; expiry dates use day `01` when only a month and year are printed. The frontend requires the user to review every value before saving.

## Database

The primary database is created automatically at the path set by `DB_PATH` (default: `billsNpayment.db`).

The connection enables:

- `journal_mode = WAL`
- `busy_timeout = 5000`
- `foreign_keys = ON`

Core tables include:

- `products`, `inventory_items`, `stock_movements`
- `purchase_bills`, `purchase_items`
- `invoices`, `invoice_items`
- `payments`
- `expiry_records`, `expiry_items`
- `credit_notes`, `credit_note_items`
- `salts`, `salt_aliases`, `product_salts`
- `suppliers` in the separate `supplier.db`

The schema setup is idempotent and designed to preserve existing rows. New columns are added through guarded `ALTER TABLE` migrations, and legacy data is migrated in place where required.

### Backups

Back up `billsNpayment.db`, `billsNpayment.db-wal`, `billsNpayment.db-shm`, and `supplier.db` before upgrades. The `backups/` directory is used for local snapshots and is not intended to be committed.

## Operational notes

- Run the backend and frontend on the same machine for the default local setup.
- Use the Vite dev server proxy or point frontend services at `http://localhost:8008`.
- Keep the `.env` file private.
- Bill extraction is the only feature that requires internet access.

## Contributing

1. Create a feature branch from `main`.
2. Keep changes scoped and consistent with the existing route/controller/service structure.
3. Run the available scripts and manually verify affected workflows.
4. Open a pull request with a clear description of the change.

## License

ISC

## Author

**Mohammad Muntazir** — MDOT / algoNdev (AND Academy)
