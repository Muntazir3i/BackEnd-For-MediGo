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

---

## 📦 Features
✔ **Billing system** – Create bills, add items, calculate totals, taxes, discounts  
✔ **Payments management** – Add customer payments, track balances  
✔ **Inventory management** – Add/update medicines, stock in/out tracking  
✔ **Ledger system** – Combined billing + payments history  
✔ **Customers & suppliers** management  
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
PORT=5000
DB_PATH=./db/mediGo.db
```

### 4. Start the server
```bash
npm start
```

The API should now be live at:
```
http://localhost:5000
```

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
curl http://localhost:5000/inventory
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
