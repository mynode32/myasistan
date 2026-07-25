import type { Product, ProductVariant } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { deleteProductChunks, syncProductChunks } from "@/lib/services/knowledge-service";
import type { CreateProductInput, UpdateProductInput } from "@/lib/validation/product";

export type ProductWithVariants = Product & { variants: ProductVariant[] };

export async function createProduct(
  storeId: string,
  input: CreateProductInput,
): Promise<ProductWithVariants> {
  const product = await prisma.product.create({
    data: {
      storeId,
      title: input.title,
      description: input.description,
      categoryId: input.categoryId,
      brand: input.brand,
      url: input.url,
      imageUrl: input.imageUrl,
      variants: { create: input.variants },
    },
    include: { variants: true },
  });

  try {
    await syncProductChunks(storeId, product);
  } catch (error) {
    console.error("Product knowledge sync failed after create", error);
  }

  return product;
}

export async function listProducts(storeId: string): Promise<ProductWithVariants[]> {
  return prisma.product.findMany({
    where: { storeId },
    include: { variants: true },
    orderBy: { createdAt: "desc" },
  });
}

export async function getProductById(
  storeId: string,
  productId: string,
): Promise<ProductWithVariants | null> {
  return prisma.product.findFirst({
    where: { id: productId, storeId },
    include: { variants: true },
  });
}

export async function updateProduct(
  storeId: string,
  productId: string,
  input: UpdateProductInput,
): Promise<ProductWithVariants> {
  const existing = await prisma.product.findFirst({ where: { id: productId, storeId } });
  if (!existing) {
    throw new Error("Ürün bulunamadı.");
  }

  const product = await prisma.product.update({
    where: { id: productId },
    data: {
      title: input.title,
      description: input.description,
      categoryId: input.categoryId,
      brand: input.brand,
      url: input.url,
      imageUrl: input.imageUrl,
    },
    include: { variants: true },
  });

  try {
    await syncProductChunks(storeId, product);
  } catch (error) {
    console.error("Product knowledge sync failed after update", error);
  }

  return product;
}

export async function deleteProduct(storeId: string, productId: string): Promise<void> {
  const existing = await prisma.product.findFirst({ where: { id: productId, storeId } });
  if (!existing) {
    throw new Error("Ürün bulunamadı.");
  }
  await prisma.product.delete({ where: { id: productId } });
  try {
    await deleteProductChunks(storeId, productId);
  } catch (error) {
    console.error("Product knowledge sync failed after delete", error);
  }
}
