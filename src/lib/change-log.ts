import { getDb } from './db';

export type ChangeAction =
  | 'submit_edit'
  | 'approve_edit'
  | 'reject_edit'
  | 'submit_delete'
  | 'approve_delete'
  | 'reject_delete';

export function logChange(spotId: number, action: ChangeAction, changes: Record<string, unknown>): void {
  try {
    const db = getDb();
    db.prepare(
      'INSERT INTO change_log (spot_id, action, changes_json, created_at) VALUES (?, ?, ?, datetime(?))',
    ).run(spotId, action, JSON.stringify(changes), 'now');
  } catch (err) {
    console.error('[change-log] Failed to log change:', err);
  }
}

export function getChangeLog(spotId: number): Array<{ id: number; action: string; changes_json: string; created_at: string }> {
  const db = getDb();
  return db.prepare('SELECT id, action, changes_json, created_at FROM change_log WHERE spot_id = ? ORDER BY created_at DESC').all(spotId) as Array<{
    id: number; action: string; changes_json: string; created_at: string;
  }>;
}

export function getRecentChanges(limit = 20): Array<{ id: number; spot_id: number; action: string; changes_json: string; created_at: string }> {
  const db = getDb();
  return db.prepare('SELECT id, spot_id, action, changes_json, created_at FROM change_log ORDER BY created_at DESC LIMIT ?').all(limit) as Array<{
    id: number; spot_id: number; action: string; changes_json: string; created_at: string;
  }>;
}
