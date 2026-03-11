import { fetchDataBySupplier } from '../db/billPayment.js';

export function getAllRecords(req, res) {
  try {
    const { supplierName } = req.query;
    if (!supplierName) {
      return res.status(400).json({ error: 'Supplier name is required' });
    }

    const data = fetchDataBySupplier(supplierName);
    const allInOneData = [...data.bills, ...data.payments];

    // Normalize and sort by date (assumes 'date', 'billDate', or 'paymentDate' exists)
    const sortedData = allInOneData
      .map(entry => ({
        ...entry,
        _normalizedDate: new Date(entry.date || entry.billDate || entry.paymentDate)
      }))
      .sort((a, b) => a._normalizedDate - b._normalizedDate)
      .map(({ _normalizedDate, ...rest }) => rest); // remove _normalizedDate before returning

    return res.status(200).json(sortedData);
  } catch (error) {
    console.error('Error fetching data:', error.message);
    return res.status(500).json({ error: 'Failed to fetch data' });
  }
}