#!/usr/bin/env node
/**
 * Reads FA + CP Data Appended CSV (Column_name, Type, Length) and generates
 * database/schema/004_raw_leads.sql with CREATE TABLE, PK, indexes, and FKs.
 *
 * Usage: node scripts/generate_raw_leads_schema.js [path-to-CSV] [path-to-output.sql]
 * Default CSV: data/FA + CP Data Appended.csv
 * Default output: database/schema/004_raw_leads.sql
 */

const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

const DEFAULT_CSV = path.join(__dirname, '..', 'data', 'FA + CP Data Appended.csv');
const DEFAULT_OUTPUT = path.join(__dirname, '..', 'database', 'schema', '004_raw_leads.sql');

const PK_COLUMN = 'autoId_ui#';  // Primary key; also accept autoId_ui
const INDEX_COLUMNS = ['zip_code', 'occupation_code', 'doc_type_code', 'last_name'];
const FK_COLUMNS = [
  { column: 'occupation_code', refTable: 'dict_occupations', refColumn: 'code' },
  { column: 'doc_type_code', altColumn: 'CurrentSaleDocumentType', refTable: 'dict_doc_types', refColumn: 'code' },
];

function quoteId(name) {
  if (!name || typeof name !== 'string') return '""';
  const s = name.trim();
  if (s === '') return '""';
  if (/^[a-z_][a-z0-9_]*$/i.test(s) && !s.includes('#')) return s;
  return '"' + s.replace(/"/g, '""') + '"';
}

function mapType(type, length) {
  const t = (type || '').toString().trim().toLowerCase();
  const len = length != null && length !== '' ? parseInt(String(length).trim(), 10) : null;
  if (t.includes('bigint')) return 'BIGINT';
  if (t.includes('int') && !t.includes('big')) return 'INTEGER';
  if (t.includes('smallint')) return 'SMALLINT';
  if (t.includes('varchar') || t === 'varchar' || t === 'char') return `VARCHAR(${Number.isFinite(len) && len > 0 ? len : 255})`;
  if (t.includes('decimal') || t.includes('numeric')) return len ? `NUMERIC(${len})` : 'NUMERIC(15,2)';
  if (t.includes('float') || t.includes('double')) return 'DOUBLE PRECISION';
  if (t.includes('date') && !t.includes('time')) return 'DATE';
  if (t.includes('datetime') || t.includes('timestamp')) return 'TIMESTAMPTZ';
  if (t.includes('time')) return 'TIME';
  if (t.includes('bool')) return 'BOOLEAN';
  return `VARCHAR(${Number.isFinite(len) && len > 0 ? len : 255})`;
}

function loadColumnDefs(csvPath) {
  const raw = fs.readFileSync(csvPath, 'utf8');
  const rows = parse(raw, { columns: true, skip_empty_lines: true, trim: true, relax_column_count: true });
  const colNameKey = Object.keys(rows[0] || {}).find((k) => /column_name/i.test(k)) || 'Column_name';
  const typeKey = Object.keys(rows[0] || {}).find((k) => /^type$/i.test(k)) || 'Type';
  const lengthKey = Object.keys(rows[0] || {}).find((k) => /length/i.test(k)) || 'Length';

  return rows
    .map((r) => ({
      name: (r[colNameKey] != null ? String(r[colNameKey]).trim() : '').replace(/^\s+|\s+$/g, ''),
      type: r[typeKey],
      length: r[lengthKey],
    }))
    .filter((c) => c.name !== '');
}

function generateSchema(columnDefs) {
  const lines = [];
  lines.push('-- Ziarem: raw_leads table (1M+ rows) - generated from FA + CP Data Appended column definitions');
  lines.push('-- Run after 003_create_dictionary_tables.sql (dict_occupations, dict_doc_types must exist).');
  lines.push('');
  lines.push('CREATE TABLE raw_leads (');
  const pkCol = columnDefs.find((c) => c.name === PK_COLUMN || c.name === 'autoId_ui');
  const colNames = columnDefs.map((c) => c.name);
  const pkName = pkCol ? pkCol.name : null;
  if (!pkName) {
    const autoId = columnDefs.find((c) => /autoId_ui/i.test(c.name));
    if (autoId) lines.push('  -- PK column: ' + autoId.name);
  }

  const columnLines = columnDefs.map((c) => {
    const q = quoteId(c.name);
    const sqlType = mapType(c.type, c.length);
    return `  ${q} ${sqlType}`;
  });
  lines.push(columnLines.join(',\n'));
  lines.push(');');
  lines.push('');

  if (pkName) {
    lines.push(`ALTER TABLE raw_leads ADD PRIMARY KEY (${quoteId(pkName)});`);
    lines.push('');
  }

  const indexCols = [
    { name: 'zip_code' },
    { name: 'occupation_code' },
    { name: 'doc_type_code', alt: 'CurrentSaleDocumentType' },
    { name: 'last_name' },
  ];
  for (const { name, alt } of indexCols) {
    const col = columnDefs.find((c) => {
      const n = c.name.toLowerCase();
      return n === name.toLowerCase() || (alt && n === alt.toLowerCase());
    });
    if (col) {
      const safeIdx = col.name.replace(/[^a-z0-9_]/gi, '_');
      lines.push(`CREATE INDEX idx_raw_leads_${safeIdx} ON raw_leads (${quoteId(col.name)});`);
    }
  }
  lines.push('');

  for (const fk of FK_COLUMNS) {
    const col = columnDefs.find((c) =>
      c.name === fk.column || c.name.toLowerCase() === fk.column.toLowerCase() ||
      (fk.altColumn && (c.name === fk.altColumn || c.name.toLowerCase() === fk.altColumn.toLowerCase()))
    );
    if (col) {
      const constraintName = 'fk_raw_leads_' + col.name.replace(/[^a-z0-9_]/gi, '_');
      lines.push(`ALTER TABLE raw_leads ADD CONSTRAINT ${constraintName} `);
      lines.push(`  FOREIGN KEY (${quoteId(col.name)}) REFERENCES ${fk.refTable}(${fk.refColumn}) ON DELETE SET NULL;`);
      lines.push('');
    }
  }

  lines.push('COMMENT ON TABLE raw_leads IS \'Raw FA + CP lead data; ~1M rows. Decode codes via dict_* tables.\';');
  return lines.join('\n');
}

function main() {
  const csvPath = path.resolve(process.argv[2] || DEFAULT_CSV);
  const outputPath = path.resolve(process.argv[3] || DEFAULT_OUTPUT);

  if (!fs.existsSync(csvPath)) {
    console.error('CSV not found:', csvPath);
    console.error('Usage: node scripts/generate_raw_leads_schema.js [path-to-CSV] [path-to-output.sql]');
    process.exit(1);
  }

  const columnDefs = loadColumnDefs(csvPath);
  console.log('Loaded', columnDefs.length, 'columns from', csvPath);

  const sql = generateSchema(columnDefs);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, sql, 'utf8');
  console.log('Wrote', outputPath);
}

main();
