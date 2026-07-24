import { parse } from "csv-parse/sync";
import { csvProductRowSchema, type CsvProductRow } from "@/lib/validation/csv";
import { createProduct } from "@/lib/services/product-service";

export type ImportResult = {
  imported: number;
  failed: number;
  errors: string[];
};

export function parseProductCsv(csvText: string): {
  rows: CsvProductRow[];
  rowErrors: string[];
} {
  const records: Record<string, string>[] = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  const rows: CsvProductRow[] = [];
  const rowErrors: string[] = [];

  records.forEach((record, index) => {
    const result = csvProductRowSchema.safeParse(record);
    if (result.success) {
      rows.push(result.data);
    } else {
      const rowNumber = index + 2; // +1 for header row, +1 for 1-based indexing
      const message = result.error.issues.map((e) => e.message).join("; ");
      rowErrors.push(`Satır ${rowNumber}: ${message}`);
    }
  });

  return { rows, rowErrors };
}

export async function importProductsFromCsv(
  storeId: string,
  csvText: string,
): Promise<ImportResult> {
  const { rows, rowErrors } = parseProductCsv(csvText);
  const errors = [...rowErrors];
  let imported = 0;

  for (const row of rows) {
    try {
      await createProduct(storeId, {
        title: row.title,
        description: row.description,
        categoryId: row.category,
        brand: row.brand,
        imageUrl: row.imageUrl || undefined,
        variants: [{ sku: row.sku, price: row.price, stockQuantity: row.stock ?? 0 }],
      });
      imported += 1;
    } catch (error) {
      errors.push(`"${row.title}" içe aktarılamadı: ${(error as Error).message}`);
    }
  }

  return { imported, failed: errors.length, errors };
}
