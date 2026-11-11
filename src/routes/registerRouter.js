import express from 'express';
import { getPrescriptionRegister } from '../controllers/registerController.js';

const router = express.Router();

router.get('/prescriptions', (req, res) => {
  try {
    getPrescriptionRegister(req, res);
  } catch (error) {
    console.error('Error building prescription register:', error);
    res.status(error.statusCode || 500).json({
      error: error.message || 'Failed to build prescription register'
    });
  }
});

export default router;
