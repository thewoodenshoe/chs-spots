#!/usr/bin/env node
/**
 * One-off script to update a spot field.
 * Usage: node scripts/update-spot-field.js <spotId> <field> <value>
 * Example: node scripts/update-spot-field.js 5079 promotion_time "6pm-9pm • Saturday"
 */

const path = require('path');
const Database = require('better-sqlite3');

const dbPath = process.env.DB_PATH || path.resolve(process.cwd(), 'data', 'chs-spots.db');
const db = new Database(dbPath);

const [id, field, ...valueParts] = process.argv.slice(2);
const value = valueParts.join(' ');

if (!id || !field || value === undefined) {
  console.error('Usage: node scripts/update-spot-field.js <spotId> <field> <value>');
  process.exit(1);
}

const allowedFields = ['promotion_time', 'title', 'description', 'source_url', 'area'];
if (!allowedFields.includes(field)) {
  console.error('Allowed fields:', allowedFields.join(', '));
  process.exit(1);
}

const existing = db.prepare('SELECT id, title, type, promotion_time FROM spots WHERE id = ?').get(id);
if (!existing) {
  console.error('Spot', id, 'not found');
  process.exit(1);
}

db.prepare(`UPDATE spots SET ${field} = ?, updated_at = datetime('now') WHERE id = ?`).run(value, id);
console.log('Updated spot', id, '|', field, '=', value);
db.close();
