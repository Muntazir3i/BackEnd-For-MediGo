# MediGo – Backend
The **backend API** for the MediGo medical shop ERP system. Built with **Node.js**, **Express**, and **better-sqlite3**, this backend powers billing, inventory, payments, ledger management, and overall shop operations.

This backend is optimized for **offline-first performance**, **fast reads**, and a structure that can be easily migrated to **MongoDB** or **PostgreSQL** later.

---

## 🚀 Tech Stack
- **Node.js** – JavaScript runtime
- **Express.js** – Minimal and fast backend framework
- **better-sqlite3** – Synchronous, high‑performance SQLite driver
- **ES Modules (import/export)** – Modern JavaScript
- **CORS** – API access from frontend
- **dotenv** – Environment variable management
- **Google Gemini** – Supplier bill image extraction

---

## 📦 Features
✔ **Billing system** – Create bills, add items, calculate totals, taxes, discounts  
✔ **Payments management** – Add customer payments, track balances  
✔ **Inventory management** – Add/update medicines, stock in/out tracking  
✔ **Ledger system** – Combined billing + payments history  
✔ **Customers & suppliers** management  
✔ **Supplier bill image extraction** – upload a printed bill and prefill the purchase form with Gemini  
✔ **Structured controllers, models, and routes**  
✔ **SQLite database** (local) with the ability to migrate to MongoDB easily  
✔ **Fast API responses** with minimal overhead  
✔ **Clean folder structure** for scaling

---

## 🗂️ Project Structure
```
mediGo-backend/
│── controller/      # Business logic for each resource
│── models/          # Database queries for each table
│── routes/          # API routes
│── db/              # SQLite database file + connection logic
│── server.js        # Entry point
│── package.json
│── .env             # Environment config
```

---

## 🛠️ Installation & Setup
### 1. Clone the repository
```bash
git clone https://github.com/yourusername/mediGo-backend.git
cd mediGo-backend
```

### 2. Install dependencies
```bash
npm install
```

### 3. Set environment variables
Create a `.env` file:
```
DB_PATH=./db/mediGo.db
GEMINI_API_KEY=your-google-ai-studio-key
GEMINI_MODEL=gemini-3.6-flash
```

`GEMINI_API_KEY` is required for supplier bill image extraction. `GEMINI_MODEL` is optional and defaults to `gemini-3.6-flash`.

### 4. Start the server
```bash
npm start
```

The API should now be live at:
```
http://localhost:8008
```

The backend port is currently set in `src/index.js`.

---

## 🧾 Supplier Bill Image Extraction

The Add page can upload a photo of a supplier bill and prefill the purchase form.

- Endpoint: `POST /api/bills/extract`
- Body: `{ base64, mimeType }`
- Accepted image types: JPG, PNG, WebP
- The frontend limits uploads to 8 MB; the backend accepts up to 14 MB decoded.
- Extraction is powered by the **Gemini API** using the prompt and JSON schema in `src/routes/billScan.js`.
- Requires `GEMINI_API_KEY` in `.env` and an internet connection.

Returned fields:

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
      "unitPrice": 0,
      "mrp": 0,
      "discount": 0,
      "gstPercentage": 0
    }
  ]
}
```

Dates are returned as `YYYY-MM-DD`. Expiry dates use day `01` when the bill prints only a month and year. Every extracted value is reviewed in the form before saving.

---

## 📡 API Overview
Below is a high-level view of the main API endpoints:

### **Inventory**
```
GET    /inventory
POST   /inventory
PUT    /inventory/:id
DELETE /inventory/:id
```

### **Billing**
```
POST   /bills
GET    /bills
GET    /bills/:id
```

### **Bill image extraction**
```
POST   /api/bills/extract
```

### **Payments**
```
POST   /payments
GET    /payments
```

### **Ledger (Bills + Payments)**
```
GET    /ledger
```

---

## 🗃️ Database
Using **better-sqlite3** for:
- Fast local reads
- Simple offline-first usage
- Zero external dependencies

Database stored at:
```
db/mediGo.db
```

You can later migrate this to **MongoDB** or **PostgreSQL** without major code changes because controllers and models follow a clean structure.

---

## 🧪 Testing the API
You can use tools like:
- Postman
- Thunder Client (VS Code)
- curl

Example request:
```bash
curl http://localhost:8008/inventory
```

---

## 🤝 Contributing
1. Fork the project  
2. Create a feature branch  
3. Commit changes  
4. Open a pull request

---

## 📄 License
Licensed under the **MIT License**.

---

## 🧑‍💻 Author
**MDOT** – Algorithm & Development Academy (algoNdev / AND Academy)
