import { salesMethodName, salesRangeError, salesSourceKinds, salesSourceName, type SalesOverviewData, type SalesPeriodMetrics, type SalesSourceTotal } from './salesOverview';

const MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MONEY_FORMAT = '"₱"#,##0.00;[Red]-"₱"#,##0.00';
const invalidExport = () => new Error('Sales data could not be exported safely. Refresh Sales Overview and try again.');
type Sheet = import('exceljs').Worksheet;
type CellValue = string | number;

function cents(value: number, signed = false): number {
  if (!Number.isSafeInteger(value) || (!signed && value < 0)) throw invalidExport();
  return value / 100;
}

function count(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw invalidExport();
  return value;
}

function text(value: string): string {
  if (typeof value !== 'string' || value.length > 32767) throw invalidExport();
  return value;
}

function addRow(sheet: Sheet, values: CellValue[]) {
  const row = sheet.addRow(values.map(value => typeof value === 'string' ? text(value) : value));
  row.eachCell(cell => {
    // ExcelJS stores strings as literal shared strings, never formulas or hyperlinks.
    if (typeof cell.value === 'string') cell.numFmt = '@';
    cell.alignment = { vertical: 'top', wrapText: true };
  });
  return row;
}

function header(sheet: Sheet, rowNumber: number, columns: number) {
  const row = sheet.getRow(rowNumber);
  row.height = 32;
  for (let column = 1; column <= columns; column++) {
    const cell = row.getCell(column);
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } };
    cell.alignment = { vertical: 'middle', wrapText: true };
  }
}

function table(sheet: Sheet, headers: string[], rows: CellValue[][], moneyColumns: number[]) {
  addRow(sheet, headers);
  rows.forEach(values => {
    const row = addRow(sheet, values);
    moneyColumns.forEach(column => { row.getCell(column).numFmt = MONEY_FORMAT; });
  });
  header(sheet, 1, headers.length);
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, rows.length + 1), column: headers.length } };
  headers.forEach((label, index) => { sheet.getColumn(index + 1).width = Math.max(21, Math.min(36, label.length + 4)); });
  sheet.getColumn(1).width = 38;
}

function metrics(metrics: SalesPeriodMetrics) {
  return [cents(metrics.sales), cents(metrics.received), cents(metrics.reversed), cents(metrics.collected, true), count(metrics.invoiceCount), cents(metrics.averageInvoiceCents)];
}

function verifiedSources(sources: SalesSourceTotal[], sales: number): SalesSourceTotal[] {
  if (!Array.isArray(sources) || sources.length !== salesSourceKinds.length
    || new Set(sources.map(source => source.kind)).size !== sources.length
    || sources.some(source => !(salesSourceKinds as readonly string[]).includes(source.kind))) throw invalidExport();
  sources.forEach(source => { cents(source.sales); count(source.lineCount); });
  if (sources.reduce((sum, source) => sum + BigInt(source.sales), 0n) !== BigInt(sales)) throw invalidExport();
  return sources;
}

/** Build only. The caller must recheck its permission/filter generation before downloading. */
export async function salesOverviewExcelFile(data: SalesOverviewData, scopeName: string): Promise<Blob> {
  if (salesRangeError(data.from, data.to)
    || data.timezone !== 'Asia/Manila' || !Number.isFinite(Date.parse(data.generatedAt))) throw invalidExport();
  const start = Date.parse(`${data.from}T00:00:00Z`);
  const duration = Date.parse(`${data.to}T00:00:00Z`) - start + 86400000;
  // The selected range has a minimum year; its preceding comparison may cross
  // that boundary. Verify the exact preceding period without applying that floor.
  if (data.previousFrom !== new Date(start - duration).toISOString().slice(0, 10)
    || data.previousTo !== new Date(start - 86400000).toISOString().slice(0, 10)) throw invalidExport();
  const current = metrics(data.totals), previous = metrics(data.previous);
  const outstanding = cents(data.totals.outstanding);
  const ExcelJS = (await import('exceljs')).default;
  const book = new ExcelJS.Workbook();
  book.creator = 'Vine';
  book.created = new Date(data.generatedAt);
  const overview = book.addWorksheet('Overview');
  addRow(overview, ['Vine — Sales Overview']);
  overview.mergeCells('A1:D1');
  header(overview, 1, 4);
  addRow(overview, []);
  addRow(overview, ['Clinic scope', text(scopeName)]);
  addRow(overview, ['Selected period (inclusive)', `${data.from} to ${data.to}`]);
  addRow(overview, ['Previous equal-length period', `${data.previousFrom} to ${data.previousTo}`]);
  addRow(overview, ['Report timezone', data.timezone]);
  addRow(overview, ['Snapshot generated at (UTC)', new Date(data.generatedAt).toISOString()]);
  addRow(overview, ['Currency', 'PHP — Philippine peso']);
  addRow(overview, []);
  addRow(overview, ['Metric', 'Selected period', 'Previous period', 'Date basis']);
  header(overview, 10, 4);
  const kpis: [string, number, number | string, string][] = [
    ['Invoiced sales', current[0], previous[0], 'Invoice posting date'],
    ['Payments received', current[1], previous[1], 'Payment recorded date'],
    ['Payment corrections', current[2], previous[2], 'Reversal recorded date'],
    ['Net collections', current[3], previous[3], 'Payments received minus corrections in each period'],
    ['Outstanding now (all dates)', outstanding, 'Not applicable', 'Current posted invoice balances at snapshot time'],
    ['Posted invoices', current[4], previous[4], 'Invoice posting date'],
    ['Average invoice value', current[5], previous[5], 'Invoiced sales / posted invoices, rounded to cents'],
  ];
  kpis.forEach((values, index) => {
    const row = addRow(overview, values);
    row.height = 32;
    row.getCell(2).numFmt = index === 5 ? '#,##0' : MONEY_FORMAT;
    if (typeof values[2] === 'number') row.getCell(3).numFmt = index === 5 ? '#,##0' : MONEY_FORMAT;
  });
  addRow(overview, []);
  addRow(overview, ['Definitions']);
  overview.mergeCells('A19:D19');
  header(overview, 19, 4);
  [
    'All sheets use the selected clinic scope. Overall totals include only branches the user is authorized to view.',
    'Sales use posted invoice values. Drafts, quotes and void invoices are excluded. Branch attribution follows the invoice clinic.',
    'Collections use payment recorded dates; corrections use reversal recorded dates. A correction reverses a recorded payment and is not a refund.',
    'Net collections can be negative when corrections exceed payments received in the selected period.',
    'Outstanding now is the current balance across all dates. It is not a historical balance at the selected end date and has no previous-period comparison.',
    'Package purchases are counted through their posted invoice once. Package session redemptions record usage and do not create another sale.',
    'Recorded invoice prices and Special Prices remain historical values; current catalogue changes do not rewrite them.',
    'Sales sources sum frozen invoice line amounts once. Appointment quotes remain appointment sales when a Visit is recorded later. Catalogue Services have no Visit link.',
    'Payments and balances belong to the invoice and are not allocated to individual Visits. Sales sources do not include patient details or clinical reference IDs.',
    'Amounts are numeric PHP values. This workbook is a read-only snapshot and includes no patient details. Dates are inclusive in Asia/Manila.',
  ].forEach(definition => {
    const row = addRow(overview, [definition]);
    overview.mergeCells(row.number, 1, row.number, 4);
    row.height = 34;
  });
  overview.columns = [{ width: 36 }, { width: 31 }, { width: 31 }, { width: 52 }];
  overview.views = [{ state: 'frozen', ySplit: 10 }];

  const branches = book.addWorksheet('Branches');
  table(branches,
    ['Clinic branch', 'Invoiced sales', 'Payments received', 'Payment corrections', 'Net collections', 'Outstanding now (all dates)', 'Posted invoices', 'Average invoice value'],
    data.branches.map(branch => {
      const values = metrics(branch);
      return [text(branch.name), ...values.slice(0, 4), cents(branch.outstanding), values[4], values[5]];
    }), [2, 3, 4, 5, 6, 8]);
  const total = addRow(branches, ['Total', ...current.slice(0, 4), outstanding, current[4], current[5]]);
  total.font = { bold: true };
  total.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6F4F1' } };
  [2, 3, 4, 5, 6, 8].forEach(column => { total.getCell(column).numFmt = MONEY_FORMAT; });
  branches.getColumn(7).numFmt = '#,##0';

  const trend = book.addWorksheet('Daily trend');
  table(trend, ['Date (Asia/Manila)', 'Invoiced sales', 'Payments received', 'Payment corrections', 'Net collections', 'Posted invoices'],
    data.trend.map(day => [text(day.date), cents(day.sales), cents(day.received), cents(day.reversed), cents(day.collected, true), count(day.invoiceCount)]), [2, 3, 4, 5]);
  trend.getColumn(6).numFmt = '#,##0';
  const methods = book.addWorksheet('Payment methods');
  table(methods, ['Payment method', 'Payments received', 'Payment corrections', 'Net collections'],
    data.paymentMethods.map(method => [text(salesMethodName(method.method)), cents(method.received), cents(method.reversed), cents(method.collected, true)]), [2, 3, 4]);

  const sources = book.addWorksheet('Sales sources');
  table(sources, ['Clinic scope', 'Invoice item source', 'Invoiced sales', 'Invoice items'],
    data.branches.flatMap(branch => verifiedSources(branch.sources, branch.sales).map(source =>
      [text(branch.name), text(salesSourceName(source.kind)), cents(source.sales), count(source.lineCount)])), [3]);
  const totalSources = verifiedSources(data.salesSources, data.totals.sales);
  // This aggregate sheet contains no patient names or Visit/appointment IDs.
  totalSources.forEach(source => {
    const row = addRow(sources, ['All selected clinics', salesSourceName(source.kind), cents(source.sales), count(source.lineCount)]);
    row.font = { bold: true };
    row.getCell(3).numFmt = MONEY_FORMAT;
  });
  sources.getColumn(4).numFmt = '#,##0';

  const bytes = new Uint8Array(await book.xlsx.writeBuffer());
  return new Blob([bytes.buffer], { type: MIME });
}

export function downloadSalesOverviewExcel(blob: Blob, from: string, to: string): void {
  if (salesRangeError(from, to)) throw invalidExport();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `vine-sales-overview-${from}-to-${to}.xlsx`;
  link.style.display = 'none';
  try { document.body.appendChild(link); link.click(); }
  finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
