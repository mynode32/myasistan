import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseProductCsv, importProductsFromCsv } from "@/lib/services/csv-import-service";
import * as productService from "@/lib/services/product-service";

describe("parseProductCsv", () => {
  it("parses valid rows", () => {
    const csv = "title,price,stock\nKoltuk Takımı,14999.90,3\nSehpa,1299.00,10\n";
    const { rows, rowErrors } = parseProductCsv(csv);

    expect(rowErrors).toHaveLength(0);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ title: "Koltuk Takımı", price: 14999.9, stock: 3 });
  });

  it("collects an error for a row missing the required title", () => {
    const csv = "title,price\n,199.00\n";
    const { rows, rowErrors } = parseProductCsv(csv);

    expect(rows).toHaveLength(0);
    expect(rowErrors).toHaveLength(1);
    expect(rowErrors[0]).toContain("title zorunludur");
  });

  it("collects an error for a non-numeric price", () => {
    const csv = "title,price\nKoltuk,abc\n";
    const { rows, rowErrors } = parseProductCsv(csv);

    expect(rows).toHaveLength(0);
    expect(rowErrors).toHaveLength(1);
  });
});

describe("importProductsFromCsv", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("creates one product per valid row and reports parse errors as failures", async () => {
    const createProductSpy = vi
      .spyOn(productService, "createProduct")
      .mockResolvedValue({ id: "product_1" } as any);

    const csv = "title,price\nKoltuk,1999.00\n,abc\n";
    const result = await importProductsFromCsv("store_1", csv);

    expect(createProductSpy).toHaveBeenCalledTimes(1);
    expect(createProductSpy).toHaveBeenCalledWith(
      "store_1",
      expect.objectContaining({
        title: "Koltuk",
        variants: [expect.objectContaining({ price: 1999 })],
      }),
    );
    expect(result.imported).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.errors).toHaveLength(1);
  });
});
