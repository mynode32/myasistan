import { z } from "zod";

export const ragQuerySchema = z.object({
  question: z.string().min(1).max(2000),
});

export type RagQueryInput = z.infer<typeof ragQuerySchema>;
