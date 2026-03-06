#!/usr/bin/env node
/**
 * One-off script to update a spot field.
 * Usage: node scripts/update-spot-field.js <spotId> <field> <value>
 * Example: node scripts/update-spot-field.js 5079 promotion_time "6pm-9pm • Saturday"
 */

const db = require('./utils/db');

const [id, field, ...valueParts] = process.argv.slice(2);
const value = valueParts.join(' ');

if (!id || !field || value === undefined) {
  console.error('Usage: node scripts/update-spot-field.js <spotId> <field> <value>');
  process.exit(1);
}

const allowedFields = [
  'promotion_time', 'title', 'description', 'source_url', 'area',
  'type', 'status', 'manual_override', 'photo_url', 'promotion_list',
  'finding_approved', 'finding_rationale', 'lat', 'lng',
];
if (!allowedFields.includes(field)) {
  console.error('Allowed fields:', allowedFields.join(', '));
  process.exit(1);
}

db.setAuditContext('admin', 'update-spot-field');

const existing = db.spots.getById(id);
if (!existing) {
  console.error('Spot', id, 'not found');
  process.exit(1);
}

const today = new Date().toISOString().split('T')[0];
db.spots.update(id, { [field]: value, last_update_date: today }, { force: true });
console.log('Updated spot', id, '|', field, '=', value, '| last_update_date =', today);
db.closeDb();
