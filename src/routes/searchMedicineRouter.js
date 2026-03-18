import express from 'express';
import { fetchSearchMed } from '../controllers/medNameSearch.js';

const router = express.Router();

// Route to search for medicines matching the provided name
router.get('/medicines/search/:name', (req, res) => {
    try {
        const name = req.params.name;
        const medicines = fetchSearchMed(name);
        res.json(medicines);
    } catch (error) {
        console.error('Error Fetching Searched Medicine:', error);
        res.status(500).json({ error: 'Failed To Fetch Searched Medicine' });
    }
});

export default router;