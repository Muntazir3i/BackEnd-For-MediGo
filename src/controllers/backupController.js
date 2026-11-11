import {
  createBackup,
  getBackupPath,
  getPendingRestore,
  listBackups,
  prepareRestore
} from '../services/backupService.js';

export function getBackups(req, res) {
  try {
    const backups = listBackups();

    res.json({
      backups,
      lastBackup: backups[0] || null,
      pendingRestore: getPendingRestore(),
      autoBackup: {
        enabled: true,
        schedule: 'Daily after 21:00',
        keep: 30
      }
    });
  } catch (error) {
    console.error('Error listing backups:', error);
    res.status(500).json({ error: error.message || 'Failed to list backups' });
  }
}

export async function postBackup(req, res) {
  try {
    const backup = await createBackup({ type: 'manual' });
    res.status(201).json({
      success: true,
      message: 'Backup created successfully',
      backup
    });
  } catch (error) {
    console.error('Error creating backup:', error);
    res.status(500).json({ error: error.message || 'Failed to create backup' });
  }
}

export async function restoreBackup(req, res) {
  try {
    const result = await prepareRestore(req.params.name);

    res.json({
      success: true,
      message:
        'Restore prepared. Restart the backend to apply it. A safety backup of the current database was created first.',
      ...result
    });
  } catch (error) {
    console.error('Error preparing restore:', error);
    const status = error.message === 'Backup not found' ? 404 : 400;
    res.status(status).json({ error: error.message || 'Failed to prepare restore' });
  }
}

export function downloadBackup(req, res) {
  try {
    const filePath = getBackupPath(req.params.name);
    res.download(filePath, req.params.name);
  } catch (error) {
    console.error('Error downloading backup:', error);
    const status = error.message === 'Backup not found' ? 404 : 400;
    res.status(status).json({ error: error.message || 'Failed to download backup' });
  }
}
