import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { deleteProductChunks, syncProductChunks } from "@/lib/services/knowledge-service";
import type { ProductWithVariants } from "@/lib/services/product-service";
import {
  createProduct,
  deleteProduct,
  getProductById,
  listProducts,
  updateProduct,
} from "@/lib/services/product-service";

vi.mock("@/lib/db/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));

vi.mock("@/lib/services/knowledge-service", () => ({
  syncProductChunks: vi.fn(),
  deleteProductChunks: vi.fn(),
}));

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const syncProductChunksMock = vi.mocked(syncProductChunks);
const deleteProductChunksMock = vi.mocked(deleteProductChunks);

function fakeProductWithVariants(overrides: Partial<ProductWithVariants> = {}): ProductWithVariants {
  return {
    id: "product_1",
    storeId: "store_1",
    externalId: null,
    title: "Koltuk",
    description: null,
    categoryId: null,
    brand: null,
    url: null,
    imageUrl: null,
    status: "ACTIVE",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    variants: [],
    ...overrides,
  };
}

beforeEach(() => {
  mockReset(prismaMock);
  syncProductChunksMock.mockReset();
  deleteProductChunksMock.mockReset();
});

describe("createProduct", () => {
  it("creates a product scoped to storeId with nested variants and syncs knowledge", async () => {
    const fakeProduct = fakeProductWithVariants();
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
    expect(syncProductChunksMock).toHaveBeenCalledWith("store_1", fakeProduct);
  });

  it("does not fail product creation when knowledge sync fails", async () => {
    const fakeProduct = fakeProductWithVariants();
    prismaMock.product.create.mockResolvedValue(fakeProduct);
    syncProductChunksMock.mockRejectedValue(new Error("OpenAI unavailable"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(
      createProduct("store_1", {
        title: "Koltuk",
        variants: [{ price: 1999.99, stockQuantity: 5 }],
      }),
    ).resolves.toEqual(fakeProduct);

    consoleError.mockRestore();
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

  it("syncs product chunks after a successful update", async () => {
    const fakeProduct = fakeProductWithVariants({ title: "Yeni" });
    prismaMock.product.findFirst.mockResolvedValue(fakeProduct);
    prismaMock.product.update.mockResolvedValue(fakeProduct);

    await updateProduct("store_1", "product_1", { title: "Yeni" });

    expect(syncProductChunksMock).toHaveBeenCalledWith("store_1", fakeProduct);
  });
});

describe("deleteProduct", () => {
  it("throws when the product does not belong to the store", async () => {
    prismaMock.product.findFirst.mockResolvedValue(null);

    await expect(deleteProduct("store_1", "missing")).rejects.toThrow("Ürün bulunamadı.");
  });

  it("deletes product chunks after a successful delete", async () => {
    prismaMock.product.findFirst.mockResolvedValue(fakeProductWithVariants());
    prismaMock.product.delete.mockResolvedValue(fakeProductWithVariants());

    await deleteProduct("store_1", "product_1");

    expect(deleteProductChunksMock).toHaveBeenCalledWith("store_1", "product_1");
  });
});
