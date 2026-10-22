export const INVENTORY_IMPORT_MAX_ROWS = 250;
export type InventoryImportRow = {
  rowNumber: number;
  name: string;
  sku: string;
  category: string;
  unit: string;
  lowStockThreshold: number;
  openingQuantity: number;
};
export type InventoryImportPreviewRow = InventoryImportRow & {
  status: 'ready' | 'skip' | 'error';
  message: string;
};
export type InventoryImportPreview = {
  previewHash: string;
  rows: InventoryImportPreviewRow[];
  readyCount: number;
  skippedCount: number;
  errorCount: number;
};
export type InventoryImportResult = {
  importedCount: number;
  skippedCount: number;
  itemIds: string[];
  replayed?: boolean;
};
