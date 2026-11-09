import express from 'express';
import { GoogleGenAI } from '@google/genai';
import 'dotenv/config';

const router = express.Router();

console.log('Gemini key loaded:', Boolean(process.env.GEMINI_API_KEY));

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

const billSchema = {
  type: 'object',
  properties: {
    invoice: { type: 'string' },
    date: { type: 'string' },
    supplierName: { type: 'string' },
    supplierDrugLn: { type: 'string' },
    supplierContact: { type: 'string' },
    products: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          batchNumber: { type: 'string' },
          expiryDate: { type: 'string' },
          stock: { type: 'number' },
          free: { type: 'number' },
          unitPrice: { type: 'number' },
          mrp: { type: 'number' },
          discount: { type: 'number' },
          gstPercentage: { type: 'number' },
        },
        required: [
          'name',
          'batchNumber',
          'expiryDate',
          'stock',
          'free',
          'unitPrice',
          'mrp',
          'discount',
          'gstPercentage',
        ],
      },
    },
  },
  required: [
    'invoice',
    'date',
    'supplierName',
    'supplierDrugLn',
    'supplierContact',
    'products',
  ],
};

router.post('/api/bills/extract', async (req, res) => {
  const { base64, mimeType } = req.body;

  // Must be exactly this regex:
  if (!base64 || !/^image\/(jpeg|png|webp)$/.test(mimeType || '')) {
    return res.status(400).json({
      message: 'Upload a JPG, PNG, or WebP bill image.',
    });
  }

  try {
    const result = await ai.models.generateContent({
      model: 'gemini-3.6-flash',
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `
Extract data from this pharmacy purchase bill image.

Follow the response schema exactly. Return only valid JSON—no explanation, Markdown, or extra fields.

Invoice:
- Extract the bill or invoice number. It may be labelled Bill No, Bill Number, Invoice No, Invoice Number, Inv No, or similar.
- Put this value in "invoice".
- If it is missing or unreadable, use "".

Bill date:
- Extract the invoice/bill date only, not the expiry date.
- Format "date" as YYYY-MM-DD when clearly readable.
- If missing, incomplete, or ambiguous, use "".

Supplier:
- Extract supplier name, drug licence number, and contact number only if clearly visible.
- Use "" for missing or unreadable values.

Products:
- Extract every product line item from the bill.
- "name": medicine/product name.
- "batchNumber": batch or lot number.
- "stock": quantity/qty/packs/boxes/strips/units for that line item.
- "free": free/bonus quantity for that line item; use 0 if absent.
- "unitPrice": purchase rate per unit or pack; exclude GST if it is shown separately.
- "mrp": MRP.
- "discount": discount percentage; use 0 if absent.
- "gstPercentage": total GST percentage; use 0 if absent.

Expiry dates:
- Store "expiryDate" strictly as YYYY-MM-DD.
- Bills usually show only month and year. Always use 01 as the day.
- For example:
  - 04/27 → 2027-04-01
  - 05/2026 → 2026-05-01
  - MAY-2026 → 2026-05-01
- Do not use manufacture dates as expiry dates.
- If the expiry date is missing or unreadable, use "".

Accuracy:
- Never invent values.
- Use "" for unreadable text.
- Use 0 for unreadable or absent numeric values.
- Return numeric values as numbers, without currency symbols or commas.
`,
            },
            {
              inlineData: {
                mimeType,
                data: base64,
              },
            },
          ],
        },
      ],
      config: {
        responseMimeType: 'application/json',
        responseJsonSchema: billSchema,
      },
    });

    res.json(JSON.parse(result.text));
  } catch (error) {
    console.error('Gemini bill extraction failed:', error);

    return res.status(502).json({
      message: error?.message || 'Gemini request failed.',
    });
  }
});

export default router;