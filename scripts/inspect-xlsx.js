#!/usr/bin/env node
/** Run: node scripts/inspect-xlsx.js <path-to.xlsx> - prints sheet names and header row for Cole/CSV mapping */
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const filePath = process.argv[2];
if (!filePath || !fs.existsSync(path.resolve(filePath))) {
  console.error('Usage: node scripts/inspect-xlsx.js <path-to.xlsx>');
  process.exit(1);
}

const workbook = XLSX.readFile(path.resolve(filePath), { cellDates: true });
const mainSheet = workbook.Sheets['FA + CP Data Appended'];
if (!mainSheet) {
  console.log('Sheets:', workbook.SheetNames);
  process.exit(0);
}
const data = XLSX.utils.sheet_to_json(mainSheet, { header: 1, defval: '' });
const headers = data[0] || [];
const colNameIdx = headers.findIndex((h) => String(h).toLowerCase().includes('column_name'));
if (colNameIdx >= 0) {
  const columnNames = data.slice(1).map((row) => row[colNameIdx]).filter(Boolean);
  console.log('Cole Data Dictionary column names (FA + CP Data Appended):');
  console.log(JSON.stringify(columnNames, null, 0));
}
console.log('\nFirst 5 full rows (dict):');
data.slice(0, 5).forEach((row, i) => console.log(i, row));
