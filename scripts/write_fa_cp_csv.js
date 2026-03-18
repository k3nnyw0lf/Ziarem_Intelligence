#!/usr/bin/env node
/**
 * Writes data/FA + CP Data Appended.csv from FA+CP column list with heuristic Type/Length.
 * Run once to create the CSV so generate_raw_leads_schema.js can produce 004_raw_leads.sql.
 * Overwrite with your own export from the xlsx if you have exact Type/Length.
 */
const fs = require('fs');
const path = require('path');
const columns = require('./fa_cp_columns.js');

function heuristicType(name) {
  const n = name.toLowerCase();
  if (n === 'autoid_ui#' || n === 'mobile_ui#' || n === 'id_individuals') return { type: 'bigint', length: '' };
  if (/\b(nbr|num|#|id)\b/.test(n) || n.endsWith('_cd') && n.length < 15) return { type: 'varchar', length: '50' };
  if (n.includes('_flag') || n === 'hh') return { type: 'varchar', length: '1' };
  if (n.includes('date') || n.includes('_dt') || n === 'dob') return { type: 'date', length: '' };
  if (n.includes('value') || n.includes('amount') || n.includes('price') || n.includes('income') || n.includes('worth')) return { type: 'decimal', length: '15' };
  if (n.includes('lat') || n.includes('lon')) return { type: 'double', length: '' };
  if (['year_1','year_2','year_3','year_4'].some((p) => n.startsWith(p)) || n.includes('yearbuilt') || n.includes('taxyear')) return { type: 'integer', length: '' };
  return { type: 'varchar', length: '255' };
}

const outPath = path.join(__dirname, '..', 'data', 'FA + CP Data Appended.csv');
const header = 'Column_name,Type,Length';
const rows = columns.map((col) => {
  const { type, length } = heuristicType(col);
  const safe = (v) => (v.includes(',') || v.includes('"') ? '"' + v.replace(/"/g, '""') + '"' : v);
  return [col, type, length].map(safe).join(',');
});
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, [header, ...rows].join('\n'), 'utf8');
console.log('Wrote', outPath, '(', rows.length, 'rows)');
