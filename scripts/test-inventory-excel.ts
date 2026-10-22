import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { Inflate } from 'pako';
import { INVENTORY_IMPORT_HEADERS, inventoryExcelFile, inventoryImportTemplate, readInventoryImportFile } from '../src/utils/inventoryExcel';

let checks = 0;
const equal = (actual: unknown, expected: unknown, message?: string) => { assert.deepEqual(actual, expected, message); checks++; };
const reject = async (action: Promise<unknown>, pattern: RegExp) => { await assert.rejects(action, pattern); checks++; };
const file = (bytes: Uint8Array, name = 'inventory.xlsx') => ({ name, size: bytes.length, arrayBuffer: async () => new Uint8Array(bytes).buffer });
const toBytes = async (book: ExcelJS.Workbook) => new Uint8Array(await book.xlsx.writeBuffer());
const parse = async (book: ExcelJS.Workbook) => readInventoryImportFile(file(await toBytes(book)));
function itemsBook(headers: readonly string[] = INVENTORY_IMPORT_HEADERS) {
  const book = new ExcelJS.Workbook();
  book.addWorksheet('Items').addRow([...headers]);
  return book;
}
const row = ['Synthetic cream', '001-CREAM', 'Consumables', 'bottle', 2, 0.125];
const validBook = () => { const book = itemsBook(); book.getWorksheet('Items')!.addRow(row); return book; };
async function editZip(bytes: Uint8Array, edit: (zip: JSZip) => void) {
  const zip = await JSZip.loadAsync(bytes); edit(zip);
  return new Uint8Array(await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }));
}
function forgeExpandedSizes(bytes: Uint8Array, name: string, claimed: number, localToo: boolean) {
  const forged = new Uint8Array(bytes), view = new DataView(forged.buffer);
  for (let offset = 0; offset < forged.length - 46; offset++) {
    if (view.getUint32(offset, true) !== 0x02014b50) continue;
    const length = view.getUint16(offset + 28, true);
    if (new TextDecoder().decode(forged.subarray(offset + 46, offset + 46 + length)) !== name) continue;
    view.setUint32(offset + 24, claimed, true);
    if (localToo) view.setUint32(view.getUint32(offset + 42, true) + 22, claimed, true);
    return forged;
  }
  throw new Error(`Synthetic ZIP entry not found: ${name}`);
}

const template = await inventoryImportTemplate();
const loadedTemplate = new ExcelJS.Workbook(); await loadedTemplate.xlsx.load(template.buffer as ArrayBuffer);
equal(loadedTemplate.worksheets.map(sheet => sheet.name), ['Items', 'Instructions']);
equal((loadedTemplate.getWorksheet('Items')!.getRow(1).values as ExcelJS.CellValue[]).slice(1), [...INVENTORY_IMPORT_HEADERS]);
equal(loadedTemplate.getWorksheet('Items')!.actualRowCount, 1, 'template must not introduce sample items');
equal(loadedTemplate.getWorksheet('Items')!.views[0].state, 'frozen');
await reject(readInventoryImportFile(file(template)), /no items/);

const exported = await inventoryExcelFile('Stocks', ['Item name', 'Remaining', 'Category'], [
  ['=HYPERLINK("https://example.invalid","click")', 0, '医療 supplies'],
  ['+SUM(A1:A2)', 0.125, '@calculation'],
  ['-1+2', null, 'Ñandú & <supplies>'],
], { branchName: '=literal branch', exportedAt: '2026-10-22T12:34:56Z' });
const loadedExport = new ExcelJS.Workbook(); await loadedExport.xlsx.load(exported.buffer as ArrayBuffer);
const stocks = loadedExport.getWorksheet('Stocks')!;
equal(stocks.getCell('A2').value, '=HYPERLINK("https://example.invalid","click")');
equal(stocks.getCell('A2').type, ExcelJS.ValueType.String, 'formula-like strings must remain plain strings');
equal(stocks.getCell('A3').value, '+SUM(A1:A2)');
equal(stocks.getCell('A4').value, '-1+2');
equal(stocks.getCell('B2').value, 0);
equal(stocks.getCell('B3').value, 0.125);
equal(stocks.getCell('B4').value, null);
equal(stocks.getCell('C2').value, '医療 supplies');
equal(stocks.getCell('C4').value, 'Ñandú & <supplies>');
equal(loadedExport.getWorksheet('Export details')!.getCell('B2').value, '=literal branch');
equal(stocks.views[0].state, 'frozen');
equal(stocks.autoFilter, 'A1:C1');
{
  const date = new Date('2026-10-22T12:34:56Z');
  const bytes = await inventoryExcelFile('Transfers', ['Created (UTC)'], [[date]], { branchName: 'A', exportedAt: date.toISOString() });
  const book = new ExcelJS.Workbook(); await book.xlsx.load(bytes.buffer as ArrayBuffer);
  equal((book.getWorksheet('Transfers')!.getCell('A2').value as Date).toISOString(), date.toISOString());
  equal(book.getWorksheet('Transfers')!.getCell('A2').numFmt, 'yyyy-mm-dd hh:mm:ss');
  equal(book.getWorksheet('Export details')!.getCell('B4').value, 'UTC');
}
await reject(inventoryExcelFile('Stocks', ['Remaining'], [[Infinity]], { branchName: 'A', exportedAt: 'now' }), /invalid value/);

equal(await parse(validBook()), [{ rowNumber: 2, name: 'Synthetic cream', sku: '001-CREAM', category: 'Consumables', unit: 'bottle', lowStockThreshold: 2, openingQuantity: 0.125 }]);
{
  const book = itemsBook();
  book.getWorksheet('Items')!.addRows([
    [' Éclair 医療 ', ' 0001 ', null, ' mL ', null, null],
    [],
    ['Second', 'SECOND', '', 'piece', '0.001', '1000000000'],
  ]);
  const parsed = await parse(book);
  equal(parsed[0], { rowNumber: 2, name: 'Éclair 医療', sku: '0001', category: '', unit: 'mL', lowStockThreshold: 0, openingQuantity: 0 });
  equal(parsed[1].rowNumber, 4, 'blank rows must preserve source row numbers');
  equal(parsed[1].lowStockThreshold, 0.001);
  equal(parsed[1].openingQuantity, 1000000000);
}
{
  const headers = [...INVENTORY_IMPORT_HEADERS].reverse();
  const book = itemsBook(headers); book.getWorksheet('Items')!.addRow([...row].reverse());
  equal((await parse(book))[0].sku, '001-CREAM', 'reordered headings map by exact name');
}
{
  const book = validBook(); book.addWorksheet('Extra notes').addRow(['Plain additional notes']);
  equal((await parse(book)).length, 1, 'plain extra sheets do not replace Items');
}
{
  const book = new ExcelJS.Workbook(); book.addWorksheet('Stock').addRows([[...INVENTORY_IMPORT_HEADERS], row]);
  await reject(parse(book), /Items sheet/);
}
for (const headers of [INVENTORY_IMPORT_HEADERS.slice(0, 5), [...INVENTORY_IMPORT_HEADERS, 'Unexpected'], ['SKU', ...INVENTORY_IMPORT_HEADERS.slice(1)], ['Name', ...INVENTORY_IMPORT_HEADERS.slice(1)]]) {
  const book = itemsBook(headers); book.getWorksheet('Items')!.addRow(row);
  await reject(parse(book), /template column headings/);
}
{
  const book = validBook(); book.getWorksheet('Items')!.getCell('G2').value = 'Unexpected data';
  await reject(parse(book), /outside the six/);
}
{
  const book = validBook(); book.getWorksheet('Items')!.getCell('G2').value = '   ';
  equal((await parse(book)).length, 1, 'unused blank columns may remain');
}
for (const badValue of [{ formula: '1+1', result: 2 }, { text: 'Click', hyperlink: 'https://example.invalid' }, { richText: [{ text: 'Rich text' }] }, new Date('2026-10-22T00:00:00Z'), { error: '#DIV/0!' }]) {
  const book = validBook(); book.getWorksheet('Items')!.getCell('A2').value = badValue as ExcelJS.CellValue;
  await reject(parse(book), /plain text or numbers/);
}
{
  const book = validBook(); book.addWorksheet('Hidden formula').getCell('A1').value = { formula: '1+1', result: 2 };
  await reject(parse(book), /plain text or numbers/);
}
for (const [column, badValue] of [['A', ''], ['B', 123], ['D', null], ['C', 12]] as const) {
  const book = validBook(); book.getWorksheet('Items')!.getCell(`${column}2`).value = badValue;
  await reject(parse(book), /required|must be text/);
}
for (const badValue of [-1, 0.0001, 1.2345, 1000000000.001, '1,000', '1e2', '12 bottles', '-1', '=2+3']) {
  const book = validBook(); book.getWorksheet('Items')!.getCell('F2').value = badValue;
  await reject(parse(book), /Opening quantity must be/);
}
{
  const book = itemsBook();
  for (let index = 0; index < 250; index++) book.getWorksheet('Items')!.addRow([`Item ${index}`, `SKU-${index}`, '', 'piece', 0, 0]);
  equal((await parse(book)).length, 250);
  book.getWorksheet('Items')!.addRow(['Too many', 'SKU-251', '', 'piece', 0, 0]);
  await reject(parse(book), /no more than 250/);
}
{
  let read = false;
  await reject(readInventoryImportFile({ name: 'huge.xlsx', size: 2 * 1024 * 1024 + 1, arrayBuffer: async () => { read = true; return new ArrayBuffer(0); } }), /no larger than 2 MiB/);
  equal(read, false, 'file size must be checked before reading');
}
for (const name of ['items.xls', 'items.csv', 'items.xlsm', 'items.xlsx.exe']) await reject(readInventoryImportFile(file(template, name)), /Choose an Excel .xlsx/);
await reject(readInventoryImportFile(file(new Uint8Array([1, 2, 3, 4]))), /not a supported Excel/);
await reject(readInventoryImportFile({ name: 'items.xlsx', size: 3, arrayBuffer: async () => new Uint8Array([1, 2]).buffer }), /read safely/);
const validBytes = await toBytes(validBook());
{
  const stored = await (await JSZip.loadAsync(validBytes)).generateAsync({ type: 'uint8array', compression: 'STORE' });
  equal((await readInventoryImportFile(file(stored)))[0].sku, '001-CREAM', 'uncompressed ZIP workbooks still import');
  await reject(readInventoryImportFile(file(forgeExpandedSizes(stored, 'xl/sharedStrings.xml', 1, true))), /not a supported Excel/);
}
{
  // Exercise the parser entry point, including forged matching local/central headers.
  // Observe the real decoder output and ensure ExcelJS never receives these archives.
  const inflatedLimit = 10 * 1024 * 1024;
  const payload = '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>'
    + 'A'.repeat(11 * 1024 * 1024) + '</t></si></sst>';
  const oversized = await editZip(validBytes, zip => { zip.file('xl/sharedStrings.xml', payload); });
  equal(oversized.length < 2 * 1024 * 1024, true, 'forged expansion fits the upload byte limit');
  const xlsxPrototype = Object.getPrototypeOf(new ExcelJS.Workbook().xlsx);
  const originalLoad = xlsxPrototype.load, originalPush = Inflate.prototype.push;
  let workbookLoads = 0, inflated = 0, largestChunk = 0;
  const observed = new WeakSet<Inflate>();
  xlsxPrototype.load = async function () { workbookLoads++; throw new Error('Workbook parsing must not start'); };
  Inflate.prototype.push = function (...args: Parameters<Inflate['push']>) {
    if (!observed.has(this)) {
      observed.add(this);
      const onData = this.onData;
      this.onData = chunk => { inflated += chunk.byteLength; largestChunk = Math.max(largestChunk, chunk.byteLength); onData.call(this, chunk); };
    }
    return originalPush.apply(this, args);
  };
  try {
    for (const localToo of [false, true]) {
      inflated = 0; largestChunk = 0;
      await reject(readInventoryImportFile(file(forgeExpandedSizes(oversized, 'xl/sharedStrings.xml', 512, localToo))), /expands beyond 10 MiB/);
      equal(inflated > inflatedLimit && inflated <= inflatedLimit + 16 * 1024, true, 'actual expansion stops within one bounded chunk of the total budget');
      equal(largestChunk <= 16 * 1024, true, 'decoder never emits an unbounded output buffer');
    }
    await reject(readInventoryImportFile(file(forgeExpandedSizes(validBytes, 'xl/sharedStrings.xml', 1, true))), /not a supported Excel/);
    const truncated = new Uint8Array(validBytes), view = new DataView(truncated.buffer);
    for (let offset = 0; offset < truncated.length - 46; offset++) {
      if (view.getUint32(offset, true) !== 0x02014b50 || view.getUint32(offset + 20, true) < 10) continue;
      view.setUint32(offset + 20, 1, true);
      view.setUint32(view.getUint32(offset + 42, true) + 18, 1, true);
      break;
    }
    await reject(readInventoryImportFile(file(truncated)), /not a supported Excel/);
    equal(workbookLoads, 0, 'oversized, size-mismatched and truncated archives fail before workbook parsing');
  } finally { xlsxPrototype.load = originalLoad; Inflate.prototype.push = originalPush; }
  const zip = await JSZip.loadAsync(validBytes);
  let existingBytes = 0;
  for (const entry of Object.values(zip.files)) existingBytes += (await entry.async('uint8array')).byteLength;
  zip.file('xl/padding.xml', ' '.repeat(inflatedLimit - existingBytes));
  const atLimit = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  equal((await readInventoryImportFile(file(atLimit)))[0].sku, '001-CREAM', 'aggregate actual expansion exactly at 10 MiB remains supported');
  zip.file('xl/padding.xml', ' '.repeat(inflatedLimit - existingBytes + 1));
  await reject(readInventoryImportFile(file(await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }))), /expands beyond 10 MiB/);
}
for (const name of ['xl/vbaProject.bin', 'xl/externalLinks/externalLink1.xml', 'xl/embeddings/oleObject1.bin', 'xl/media/image1.png', 'xl/activeX/control.xml']) {
  const bytes = await editZip(validBytes, zip => { zip.file(name, 'not allowed'); });
  await reject(readInventoryImportFile(file(bytes)), /not a supported Excel/);
}
{
  const bytes = await editZip(validBytes, zip => { zip.file('xl/oversized.xml', 'x'.repeat(10 * 1024 * 1024 + 1)); });
  await reject(readInventoryImportFile(file(bytes)), /not a supported Excel|expands beyond/);
}
{
  const bytes = await editZip(validBytes, zip => { for (let index = 0; index < 260; index++) zip.file(`extra/${index}.xml`, 'x'); });
  await reject(readInventoryImportFile(file(bytes)), /not a supported Excel/);
}
{
  const bytes = new Uint8Array(validBytes);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < bytes.length - 46; index++) {
    if (view.getUint32(index, true) === 0x02014b50) { view.setUint16(index + 8, view.getUint16(index + 8, true) | 1, true); break; }
  }
  await reject(readInventoryImportFile(file(bytes)), /not a supported Excel/);
}
{
  const bytes = await editZip(validBytes, zip => { zip.file('xl/workbook.xml', '<broken>'); });
  await reject(readInventoryImportFile(file(bytes)), /workbook could not be read|Items sheet/);
}

console.log(`${checks}/${checks} inventory Excel checks passed.`);
