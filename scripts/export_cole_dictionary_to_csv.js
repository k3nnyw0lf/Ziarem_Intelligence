#!/usr/bin/env node
/**
 * Export Cole Data Dictionary (FA + CP Data Appended) from xlsx to CSV.
 * Single source of truth: Cole_Data Dictionary_Apr2024.xlsx → data/FA + CP Data Appended.csv
 * Use this CSV to generate schema or validate column names.
 *
 * Usage: node scripts/export_cole_dictionary_to_csv.js [path-to-Cole_Data Dictionary_Apr2024.xlsx]
 * Default: c:\Users\Kenne\Downloads\Cole_Data Dictionary_Apr2024.xlsx
 */

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const DEFAULT_XLSX = path.join(process.env.USERPROFILE || '', 'Downloads', 'Cole_Data Dictionary_Apr2024.xlsx');
const OUT_CSV = path.join(__dirname, '..', 'data', 'FA + CP Data Appended.csv');

const SHEET_NAME = 'FA + CP Data Appended';

function main() {
  const xlsxPath = path.resolve(process.argv[2] || DEFAULT_XLSX);
  if (!fs.existsSync(xlsxPath)) {
    console.error('File not found:', xlsxPath);
    console.error('Usage: node scripts/export_cole_dictionary_to_csv.js [path-to-xlsx]');
    process.exit(1);
  }

  const workbook = XLSX.readFile(xlsxPath, { cellDates: true });
  const sheet = workbook.Sheets[SHEET_NAME];
  if (!sheet) {
    console.error('Sheet not found:', SHEET_NAME, 'in', workbook.SheetNames);
    process.exit(1);
  }

  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  const headers = rows[0] || [];
  const colNameIdx = headers.findIndex((h) => String(h).toLowerCase().includes('column_name'));
  const typeIdx = headers.findIndex((h) => String(h).toLowerCase() === 'type');
  const lengthIdx = headers.findIndex((h) => String(h).toLowerCase().includes('length'));

  if (colNameIdx < 0) {
    console.error('Column_name column not found. Headers:', headers);
    process.exit(1);
  }

  const csvRows = [['Column_name', 'Type', 'Length']];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const colName = row[colNameIdx] != null ? String(row[colNameIdx]).trim() : '';
    if (!colName) continue;
    const type = typeIdx >= 0 ? (row[typeIdx] != null ? String(row[typeIdx]).trim() : '') : '';
    const length = lengthIdx >= 0 ? (row[lengthIdx] != null ? String(row[lengthIdx]).trim() : '') : '';
    csvRows.push([colName, type, length]);
  }

  const csv = csvRows.map((row) => row.map((cell) => (String(cell).includes(',') || String(cell).includes('"') ? '"' + String(cell).replace(/"/g, '""') + '"' : cell)).join(',')).join('\n');

  fs.mkdirSync(path.dirname(OUT_CSV), { recursive: true });
  fs.writeFileSync(OUT_CSV, csv, 'utf8');
  console.log('Exported', csvRows.length - 1, 'columns to', OUT_CSV);
}

main();
