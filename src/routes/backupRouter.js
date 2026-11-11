import express from 'express';
import {
  downloadBackup,
  getBackups,
  postBackup,
  restoreBackup
} from '../controllers/backupController.js';

const router = express.Router();

router.get('/', getBackups);
router.post('/', postBackup);
router.post('/:name/restore', restoreBackup);
router.get('/:name/download', downloadBackup);

export default router;
