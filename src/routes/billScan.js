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
              text: `Extract data from this pharmacy purchase bill image.

Follow the response schema exactly. Return only valid JSON—no explanation, Markdown, or extra fields.

INVOICE:
- Extract the bill or invoice number. It may be labelled Bill No, Bill Number, Invoice No, Invoice Number, Inv No, or similar.
- Put this value in "invoice".
- If missing or unreadable, use "".

BILL DATE:
- Extract the invoice/bill date only, not the expiry or manufacture date.
- Format as YYYY-MM-DD when clearly readable.
- If missing, incomplete, or ambiguous, use "".

SUPPLIER:
- Extract supplier name, drug licence number, and contact number only if clearly visible.
- Use "" for missing or unreadable values.

PRODUCTS:
Extract every product line item from the bill.

For each product, extract:

- "name": Extract ONLY the actual medicine/product brand name and its strength.
  
  PRODUCT NAME CLEANING RULES:
  - Remove dosage-form words such as Tab, Tablet, Tablets, Cap, Caps, Capsule, Capsules, Cream, Gargles, Syrup, Suspension, Drops, Injection, Ointment, Gel, Lotion, and similar descriptive terms.
  - Remove text enclosed in angle brackets, such as <Lot>.
  - Remove packaging and manufacturing descriptors.
  - Remove unnecessary prefixes, suffixes, and descriptive information.
  - Preserve the actual brand/product name.
  - Preserve medicine strength, including mg, mcg, g, ml, IU, and similar units.
  - Do not remove numbers that are part of the actual brand name or strength.
  - Do not replace brand names with generic ingredient names.
  - Do not include dosage-form descriptions in the final name.
  - If the actual product name cannot be confidently identified, use "".

  Examples:
  - "Dolo 650 Tab" -> "Dolo 650"
  - "Pan 40 Tablets" -> "Pan 40"
  - "Augmentin 625 Cap" -> "Augmentin 625"
  - "ABC 500mg Capsules" -> "ABC 500mg"
  - "XYZ 10mg Cream <Lot>" -> "XYZ 10mg"

- "batchNumber": Batch or lot number.
- "stock": Quantity/qty/packs/boxes/strips/units for that line item.
- "free": Free or bonus quantity. Use 0 if absent.
- "unitPrice": Purchase rate per unit or pack, excluding GST if shown separately.
- "mrp": MRP.
- "discount": Discount percentage. Use 0 if absent.
- "gstPercentage": Total GST percentage. Use 0 if absent.
- "expiryDate": Expiry date strictly formatted as YYYY-MM-DD.

EXPIRY DATES:
Bills usually show only month and year. Always use 01 as the day.

Examples:
- 04/27 -> 2027-04-01
- 05/2026 -> 2026-05-01
- MAY-2026 -> 2026-05-01

Do not use manufacture dates as expiry dates.
If expiry date is missing or unreadable, use "".

ACCURACY RULES:
- Never invent values.
- Use "" for unreadable or missing text values.
- Use 0 for unreadable or absent numeric values.
- Return numeric values as numbers, without currency symbols or commas.
- Extract every visible product line. Do not skip products.
- Do not merge separate product lines.
- Do not mistake batch numbers, HSN codes, or invoice references for product names.
- Preserve the original product order.
- Apply product name cleaning ONLY to the name field.

RESPONSE SCHEMA:

{
  "invoice": "",
  "date": "",
  "supplier": {
    "name": "",
    "drugLicence": "",
    "contact": ""
  },
  "products": [
    {
      "name": "",
      "batchNumber": "",
      "stock": 0,
      "free": 0,
      "unitPrice": 0,
      "mrp": 0,
      "discount": 0,
      "gstPercentage": 0,
      "expiryDate": ""
    }
  ]
}`,
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