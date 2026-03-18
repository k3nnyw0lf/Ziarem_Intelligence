#!/usr/bin/env node
/**
 * Populate Ziarem lookup tables from Data Dictionary CSVs.
 * Reads: Occupation.csv, Occupation Code.csv, DOC_TYPE.csv, PROP_CL_IND.csv
 * Upserts code + description into dict_occupations, dict_doc_types, dict_property_class.
 *
 * Usage: node seed_dictionaries.js [directory]
 * Default directory: ./data/dictionaries
 */

const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { pool } = require('./src/db');

const DEFAULT_DIR = path.join(__dirname, 'data', 'dictionaries');

const TABLE_CONFIG = [
  {
    table: 'dict_occupations',
    files: [
      { file: 'Occupation.csv', codeKeys: ['code', '1'], descKeys: ['description', '2'] },
      { file: 'Occupation Code.csv', codeKeys: ['occupation code', 'code'], descKeys: ['occupation name', 'description', 'desc'] },
    ],
  },
  {
    table: 'dict_doc_types',
    files: [{ file: 'DOC_TYPE.csv', codeKeys: ['code'], descKeys: ['desc', 'description'] }],
  },
  {
    table: 'dict_property_class',
    files: [{ file: 'PROP_CL_IND.csv', codeKeys: ['code'], descKeys: ['desc', 'description'] }],
  },
];

function normalizeKey(s) {
  return (s == null ? '' : String(s)).trim().toLowerCase();
}

function findColumnKey(record, keys) {
  const recordKeys = Object.keys(record || {});
  for (const k of keys) {
    const found = recordKeys.find((r) => normalizeKey(r) === normalizeKey(k));
    if (found) return found;
  }
  return null;
}

function resolvePath(dir, filename) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const lower = filename.toLowerCase();
  const found = entries.find((e) => e.isFile() && e.name.toLowerCase() === lower);
  return found ? path.join(dir, found.name) : null;
}

function loadCsv(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return parse(raw, { columns: true, skip_empty_lines: true, trim: true, relax_column_count: true });
}

function extractRows(rows, codeKeys, descKeys) {
  if (rows.length === 0) return [];
  const first = rows[0];
  const keys = Object.keys(first);
  let codeCol = findColumnKey(first, codeKeys);
  let descCol = findColumnKey(first, descKeys);
  if (!codeCol && keys.length >= 1) codeCol = keys[0];
  if (!descCol && keys.length >= 2) descCol = keys[1];
  if (!codeCol || !descCol) return [];

  return rows
    .map((row) => {
      const code = row[codeCol] != null ? String(row[codeCol]).trim() : '';
      const desc = row[descCol] != null ? String(row[descCol]).trim() : '';
      return { code, description: desc };
    })
    .filter((r) => r.code !== '' || r.description !== '');
}

async function seedTable(tableName, rows) {
  if (rows.length === 0) return 0;
  const seen = new Set();
  const unique = rows.filter((r) => {
    const key = r.code;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  for (const row of unique) {
    await pool.query(
      `INSERT INTO ${tableName} (code, description) VALUES ($1, $2)
       ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description`,
      [row.code, row.description || '']
    );
  }
  return unique.length;
}

async function run() {
  const dir = path.resolve(process.argv[2] || DEFAULT_DIR);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    console.error('Directory not found:', dir);
    console.error('Usage: node seed_dictionaries.js [directory]');
    process.exit(1);
  }

  console.log('Reading from:', dir);

  for (const { table, files } of TABLE_CONFIG) {
    const allRows = [];
    for (const { file, codeKeys, descKeys } of files) {
      const filePath = resolvePath(dir, file);
      if (!filePath) continue;
      const rows = loadCsv(filePath);
      const extracted = extractRows(rows, codeKeys, descKeys);
      if (extracted.length > 0) {
        console.log('  ', file, '->', extracted.length, 'rows');
        allRows.push(...extracted);
      }
    }
    if (allRows.length === 0) {
      console.log('  [skip]', table, '(no matching files)');
      continue;
    }
    const count = await seedTable(table, allRows);
    console.log('  ->', table, ':', count, 'rows upserted');
  }

  await pool.end();
  console.log('Done.');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
