import { z } from "zod";

export const productVariantInputSchema = z.object({
  sku: z.string().max(64).optional(),
  title: z.string().max(120).optional(),
  price: z.number().positive(),
  compareAtPrice: z.number().positive().optional(),
  stockQuantity: z.number().int().min(0).default(0),
});

export const createProductSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  categoryId: z.string().max(120).optional(),
  brand: z.string().max(120).optional(),
  url: z.string().url().optional(),
  imageUrl: z.string().url().optional(),
  variants: z.array(productVariantInputSchema).min(1),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;

export const updateProductSchema = createProductSchema.partial();

export type UpdateProductInput = z.infer<typeof updateProductSchema>;
