import { INVENTORY_IMPORT_MAX_ROWS, type InventoryImportRow } from '../inventoryImportPolicy';
import { inventoryQuantity } from '../inventoryPolicy';

export const INVENTORY_IMPORT_HEADERS = ['Item name', 'SKU', 'Category', 'Stock unit', 'Low-stock threshold', 'Opening quantity'] as const;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 10 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 256;
const INFLATE_CHUNK_BYTES = 16 * 1024;
const MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const unsupportedWorkbook = () => new Error('This is not a supported Excel workbook. Save a plain .xlsx copy using the import template.');
const expandedWorkbook = () => new Error('The workbook expands beyond 10 MiB. Use a smaller import file.');
type ArchiveEntry = { data: Uint8Array; method: number; expandedBytes: number };

async function workbook() {
  const ExcelJS = (await import('exceljs')).default;
  return new ExcelJS.Workbook();
}

function styleSheet(sheet: import('exceljs').Worksheet, headers: readonly string[]) {
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
  sheet.getRow(1).height = 28;
  sheet.getRow(1).eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } };
    cell.alignment = { vertical: 'middle', wrapText: true };
  });
  headers.forEach((header, index) => {
    sheet.getColumn(index + 1).width = Math.max(18, Math.min(44, header.length + 8));
  });
}

function safeValue(value: string | number | Date | null): string | number | Date | null {
  if (value === null || typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  throw new Error('The export contains an invalid value. Refresh inventory and try again.');
}

export async function inventoryExcelFile(
  sheetName: string,
  headers: string[],
  rows: (string | number | Date | null)[][],
  context: { branchName: string; exportedAt: string },
): Promise<Uint8Array> {
  const book = await workbook();
  const sheet = book.addWorksheet(sheetName);
  sheet.addRow(headers);
  for (const row of rows) {
    const added = sheet.addRow(row.map(safeValue));
    added.eachCell(cell => {
      // Explicit strings remain literal text, including values beginning with =, +, - or @.
      if (typeof cell.value === 'string') cell.numFmt = '@';
      if (cell.value instanceof Date) cell.numFmt = 'yyyy-mm-dd hh:mm:ss';
      cell.alignment = { vertical: 'top', wrapText: true };
    });
  }
  styleSheet(sheet, headers);
  const notes = book.addWorksheet('Export details');
  notes.addRows([
    ['Vine Inventory export'],
    ['Clinic branch', context.branchName],
    ['Exported at', context.exportedAt],
    ['Date/time timezone', 'UTC'],
    ['This workbook is a reference export. Use the separate import template to add new items.'],
    ['Quantities use each item’s recorded stock unit; different stock units are not interchangeable.'],
  ]);
  notes.columns = [{ width: 100 }, { width: 55 }];
  return new Uint8Array(await book.xlsx.writeBuffer());
}

export async function inventoryImportTemplate(): Promise<Uint8Array> {
  const book = await workbook();
  const sheet = book.addWorksheet('Items');
  sheet.addRow([...INVENTORY_IMPORT_HEADERS]);
  styleSheet(sheet, INVENTORY_IMPORT_HEADERS);
  sheet.getColumn(1).width = 36;
  sheet.getColumn(3).width = 30;
  const instructions = book.addWorksheet('Instructions');
  instructions.addRows([
    ['Vine Inventory — new-item import'],
    [`Add up to ${INVENTORY_IMPORT_MAX_ROWS} items to the Items sheet. Keep its six column headings unchanged.`],
    ['This adds new SKUs only. Existing SKUs are skipped; existing items and balances are never overwritten.'],
    ['Item name, SKU and Stock unit are required text. Category must match an existing active category name or be blank.'],
    ['Low-stock threshold and Opening quantity are optional; blank means zero. Use nonnegative numbers with at most three decimal places.'],
    ['Do not use formulas, hyperlinks, images, macros, external links or embedded files. Save as an .xlsx workbook.'],
    ['Choose the receiving branch and opening-stock date/time in Vine, then review the preview before confirming.'],
    ['Opening stock is recorded as a stock movement. A reference export is not an import template.'],
  ]);
  instructions.getColumn(1).width = 115;
  instructions.eachRow(row => { row.height = 36; row.alignment = { wrapText: true, vertical: 'middle' }; });
  instructions.getRow(1).font = { bold: true, size: 14, color: { argb: 'FF0F766E' } };
  return new Uint8Array(await book.xlsx.writeBuffer());
}

/** Inspect the ZIP directory before the XLSX parser can expand user-controlled contents. */
function checkArchive(bytes: Uint8Array) {
  const bad = unsupportedWorkbook;
  if (bytes.length < 22) throw bad();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--) {
    if (view.getUint32(offset, true) === 0x06054b50 && offset + 22 + view.getUint16(offset + 20, true) === bytes.length) {
      end = offset; break;
    }
  }
  if (end < 0 || view.getUint16(end + 4, true) || view.getUint16(end + 6, true)) throw bad();
  const count = view.getUint16(end + 10, true);
  const start = view.getUint32(end + 16, true);
  if (!count || count > MAX_ZIP_ENTRIES || count !== view.getUint16(end + 8, true)
    || start + view.getUint32(end + 12, true) !== end) throw bad();
  let offset = start, expanded = 0;
  const names = new Set<string>();
  const entries: ArchiveEntry[] = [];
  try {
    for (let entry = 0; entry < count; entry++) {
      if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) throw bad();
      const flags = view.getUint16(offset + 8, true), method = view.getUint16(offset + 10, true);
      const compressed = view.getUint32(offset + 20, true), uncompressed = view.getUint32(offset + 24, true);
      const nameLength = view.getUint16(offset + 28, true), extraLength = view.getUint16(offset + 30, true), commentLength = view.getUint16(offset + 32, true);
      const localOffset = view.getUint32(offset + 42, true);
      if (flags & 0x41 || ![0, 8].includes(method) || view.getUint16(offset + 34, true)
        || offset + 46 + nameLength + extraLength + commentLength > end
        || compressed > MAX_FILE_BYTES || uncompressed > MAX_EXPANDED_BYTES || localOffset + 30 > start) throw bad();
      const name = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
      const lower = name.toLowerCase();
      if (!name || names.has(lower) || name.includes('\\') || name.startsWith('/') || name.split('/').includes('..')
        || /(^|\/)(embeddings|externallinks|activex|media|macrosheets|querytables)(\/|$)/i.test(name)
        || lower === 'xl/connections.xml'
        || /\.(bin|vba|exe|dll)$/i.test(name) || lower === 'encryptioninfo' || lower === 'encryptedpackage') throw bad();
      names.add(lower);
      if (view.getUint32(localOffset, true) !== 0x04034b50 || view.getUint16(localOffset + 6, true) !== flags
        || view.getUint16(localOffset + 8, true) !== method) throw bad();
      const localNameLength = view.getUint16(localOffset + 26, true), localExtraLength = view.getUint16(localOffset + 28, true);
      const contentStart = localOffset + 30 + localNameLength + localExtraLength;
      if (contentStart + compressed > start
        || new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(localOffset + 30, localOffset + 30 + localNameLength)) !== name) throw bad();
      expanded += uncompressed;
      if (expanded > MAX_EXPANDED_BYTES) throw expandedWorkbook();
      entries.push({ data: bytes.subarray(contentStart, contentStart + compressed), method, expandedBytes: uncompressed });
      offset += 46 + nameLength + extraLength + commentLength;
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('The workbook expands')) throw error;
    throw bad();
  }
  if (offset !== end || !names.has('[content_types].xml') || !names.has('xl/workbook.xml')) throw bad();
  return entries;
}

/** Count and discard actual output in bounded chunks; ZIP size fields are untrusted. */
async function checkExpandedContents(entries: ArchiveEntry[]) {
  const { Inflate } = await import('pako');
  let expanded = 0;
  for (const entry of entries) {
    let entryBytes = 0;
    const count = (length: number) => {
      expanded += length;
      entryBytes += length;
      if (expanded > MAX_EXPANDED_BYTES) throw expandedWorkbook();
    };
    if (entry.method === 0) count(entry.data.byteLength);
    else {
      const inflater = new Inflate({ raw: true, chunkSize: INFLATE_CHUNK_BYTES });
      let finished = false;
      // Replacing both handlers avoids retaining or joining decompressed chunks.
      inflater.onData = chunk => count(chunk.byteLength);
      inflater.onEnd = status => { finished = status === 0; };
      inflater.push(entry.data, true);
      if (!finished) throw unsupportedWorkbook();
    }
    if (entryBytes !== entry.expandedBytes) throw unsupportedWorkbook();
  }
}

function plainCell(cell: import('exceljs').Cell, rowNumber: number): string | number | null {
  const value = cell.value;
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' && Number.isFinite(value)) return value;
  throw new Error(`Row ${rowNumber}: use plain text or numbers only. Formulas, hyperlinks, dates and formatted objects are not supported.`);
}

function textValue(value: string | number | null, column: string, row: number, required = false): string {
  if (value === null || value === '') {
    if (required) throw new Error(`Row ${row}: ${column} is required.`);
    return '';
  }
  if (typeof value !== 'string') throw new Error(`Row ${row}: ${column} must be text. Format the cell as Text to preserve its value.`);
  const text = value.trim();
  if (required && !text) throw new Error(`Row ${row}: ${column} is required.`);
  return text;
}

function numericValue(value: string | number | null, column: string, row: number): number {
  if (value === null || typeof value === 'string' && !value.trim()) return 0;
  if (typeof value === 'string' && !/^\d+(?:\.\d{1,3})?$/.test(value.trim())) {
    throw new Error(`Row ${row}: ${column} must be a nonnegative number with at most three decimal places.`);
  }
  const number = typeof value === 'number' ? value : Number(value.trim());
  try { return inventoryQuantity(number, false, true); }
  catch { throw new Error(`Row ${row}: ${column} must be between 0 and 1,000,000,000 with at most three decimal places.`); }
}

export async function readInventoryImportFile(file: { name: string; size: number; arrayBuffer(): Promise<ArrayBuffer> }): Promise<InventoryImportRow[]> {
  if (!/\.xlsx$/i.test(file.name)) throw new Error('Choose an Excel .xlsx file. Other spreadsheet formats are not supported.');
  if (!Number.isFinite(file.size) || file.size <= 0 || file.size > MAX_FILE_BYTES) throw new Error('Choose an .xlsx file no larger than 2 MiB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length !== file.size || bytes.length > MAX_FILE_BYTES) throw new Error('The file could not be read safely. Choose the file again.');
  await checkExpandedContents(checkArchive(bytes));
  const book = await workbook();
  try { await book.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer); }
  catch { throw new Error('The Excel workbook could not be read. Save a plain .xlsx copy using the import template.'); }
  const sheet = book.getWorksheet('Items');
  if (!sheet) throw new Error('The workbook must contain an Items sheet. Use the import template.');
  // Reject active or opaque cell values even on additional sheets; never evaluate formulas or follow links.
  book.eachSheet(candidate => candidate.eachRow(row => row.eachCell(cell => { plainCell(cell, row.number); })));
  const columns = new Map<string, number>();
  sheet.getRow(1).eachCell((cell, index) => {
    const header = plainCell(cell, 1);
    if (typeof header !== 'string' || !INVENTORY_IMPORT_HEADERS.includes(header as typeof INVENTORY_IMPORT_HEADERS[number]) || columns.has(header)) {
      throw new Error('The Items sheet must have the six unique template column headings, with no extra headings.');
    }
    columns.set(header, index);
  });
  if (columns.size !== INVENTORY_IMPORT_HEADERS.length) throw new Error('The Items sheet must have all six template column headings.');
  const allowedColumns = new Set(columns.values());
  const result: InventoryImportRow[] = [];
  sheet.eachRow(row => {
    if (row.number === 1) return;
    let nonempty = false;
    row.eachCell((cell, index) => {
      const value = plainCell(cell, row.number);
      if (value !== null && (typeof value !== 'string' || value.trim())) {
        nonempty = true;
        if (!allowedColumns.has(index)) throw new Error(`Row ${row.number}: remove values outside the six template columns.`);
      }
    });
    if (!nonempty) return;
    if (result.length >= INVENTORY_IMPORT_MAX_ROWS) throw new Error(`Import no more than ${INVENTORY_IMPORT_MAX_ROWS} nonempty item rows at a time.`);
    const value = (header: typeof INVENTORY_IMPORT_HEADERS[number]) => plainCell(row.getCell(columns.get(header)!), row.number);
    result.push({
      rowNumber: row.number,
      name: textValue(value('Item name'), 'Item name', row.number, true),
      sku: textValue(value('SKU'), 'SKU', row.number, true),
      category: textValue(value('Category'), 'Category', row.number),
      unit: textValue(value('Stock unit'), 'Stock unit', row.number, true),
      lowStockThreshold: numericValue(value('Low-stock threshold'), 'Low-stock threshold', row.number),
      openingQuantity: numericValue(value('Opening quantity'), 'Opening quantity', row.number),
    });
  });
  if (!result.length) throw new Error('The Items sheet has no items. Add at least one item below the headings.');
  return result;
}

export function downloadInventoryExcel(bytes: Uint8Array, filename: string): void {
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes).buffer], { type: MIME }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`;
  link.style.display = 'none';
  try { document.body.appendChild(link); link.click(); }
  finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
