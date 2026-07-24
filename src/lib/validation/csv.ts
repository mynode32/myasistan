import { z } from "zod";

export const csvProductRowSchema = z.object({
  title: z.string().min(1, "title zorunludur"),
  description: z.string().optional(),
  category: z.string().optional(),
  brand: z.string().optional(),
  price: z.coerce.number().positive("price pozitif bir sayı olmalı"),
  stock: z.coerce.number().int().min(0).optional().default(0),
  sku: z.string().optional(),
  imageUrl: z.string().url().optional().or(z.literal("")),
});

export type CsvProductRow = z.infer<typeof csvProductRowSchema>;
