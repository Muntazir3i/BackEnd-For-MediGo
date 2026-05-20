import fs from "fs";
import path from "path";

const invoicesDir = path.join(process.cwd(), "invoices");

// create invoices folder automatically
if (!fs.existsSync(invoicesDir)) {
    fs.mkdirSync(invoicesDir);
}

// ==============================
// SAVE INVOICE
// ==============================

export const saveInvoice = async (req, res) => {
    try {

        const invoice = req.body;

        const today = new Date().toISOString().split("T")[0];

        const filePath = path.join(invoicesDir, `${today}.json`);

        let existingInvoices = [];

        // if file exists read previous invoices
        if (fs.existsSync(filePath)) {

            const data = fs.readFileSync(filePath, "utf-8");

            existingInvoices = JSON.parse(data);
        }

        existingInvoices.push(invoice);

        fs.writeFileSync(
            filePath,
            JSON.stringify(existingInvoices, null, 2)
        );

        res.status(201).json({
            success: true,
            message: "Invoice Saved",
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            success: false,
            message: "Error saving invoice",
        });
    }
};

// ==============================
// GET INVOICE BY DATE + NAME
// ==============================

export const getInvoicesByDateAndCustomer = async (req, res) => {
    try {

        const { date, customer } = req.query;

        if (!date) {
            return res.status(400).json({
                success: false,
                message: "Date is required",
            });
        }

        const filePath = path.join(invoicesDir, `${date}.json`);

        if (!fs.existsSync(filePath)) {
            return res.json([]);
        }

        const data = fs.readFileSync(filePath, "utf-8");

        let invoices = JSON.parse(data);

        // filter by customer name
        if (customer) {

            invoices = invoices.filter((invoice) =>
                invoice.customer?.name
                    ?.toLowerCase()
                    .includes(customer.toLowerCase())
            );
        }

        res.json(invoices);

    } catch (error) {

        console.error(error);

        res.status(500).json({
            success: false,
            message: "Error fetching invoices",
        });
    }
};