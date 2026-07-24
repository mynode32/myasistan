import { z } from "zod";

export const updateStoreSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  domain: z.string().url().optional(),
  language: z.string().min(2).max(10).optional(),
  currency: z.string().min(3).max(3).optional(),
  timezone: z.string().min(2).max(64).optional(),
});

export type UpdateStoreInput = z.infer<typeof updateStoreSchema>;
