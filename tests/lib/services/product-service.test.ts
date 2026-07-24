import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockDeep, mockReset, DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import {
  createProduct,
  listProducts,
  getProductById,
  updateProduct,
  deleteProduct,
} from "@/lib/services/product-service";

vi.mock("@/lib/db/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

beforeEach(() => {
  mockReset(prismaMock);
});

describe("createProduct", () => {
  it("creates a product scoped to storeId with nested variants", async () => {
    const fakeProduct = { id: "product_1", storeId: "store_1", title: "Koltuk", variants: [] } as any;
    prismaMock.product.create.mockResolvedValue(fakeProduct);

    const result = await createProduct("store_1", {
      title: "Koltuk",
      variants: [{ price: 1999.99, stockQuantity: 5 }],
    });

    expect(result).toEqual(fakeProduct);
    expect(prismaMock.product.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          storeId: "store_1",
          title: "Koltuk",
          variants: { create: [{ price: 1999.99, stockQuantity: 5 }] },
        }),
      }),
    );
  });
});

describe("listProducts", () => {
  it("only queries products for the given storeId", async () => {
    prismaMock.product.findMany.mockResolvedValue([]);

    await listProducts("store_1");

    expect(prismaMock.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { storeId: "store_1" } }),
    );
  });
});

describe("getProductById", () => {
  it("returns null when the product belongs to a different store", async () => {
    prismaMock.product.findFirst.mockResolvedValue(null);

    const result = await getProductById("store_1", "product_from_other_store");

    expect(result).toBeNull();
    expect(prismaMock.product.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "product_from_other_store", storeId: "store_1" } }),
    );
  });
});

describe("updateProduct", () => {
  it("throws when the product does not belong to the store", async () => {
    prismaMock.product.findFirst.mockResolvedValue(null);

    await expect(updateProduct("store_1", "missing", { title: "Yeni" })).rejects.toThrow(
      "Ürün bulunamadı.",
    );
  });
});

describe("deleteProduct", () => {
  it("throws when the product does not belong to the store", async () => {
    prismaMock.product.findFirst.mockResolvedValue(null);

    await expect(deleteProduct("store_1", "missing")).rejects.toThrow("Ürün bulunamadı.");
  });
});
