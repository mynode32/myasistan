import { z } from "zod";

export const knowledgeSourceTypeSchema = z.enum([
  "FAQ",
  "SHIPPING_POLICY",
  "RETURN_POLICY",
  "WARRANTY",
  "CAMPAIGN",
  "BLOG",
  "CUSTOM",
]);

export const createKnowledgeDocumentSchema = z.object({
  sourceType: knowledgeSourceTypeSchema,
  title: z.string().min(1).max(200),
  content: z.string().min(1).max(20000),
  language: z.string().min(2).max(10).default("tr"),
});

export type CreateKnowledgeDocumentInput = z.infer<typeof createKnowledgeDocumentSchema>;

export const updateKnowledgeDocumentSchema = createKnowledgeDocumentSchema.partial().refine(
  (input) => Object.keys(input).length > 0,
  "Güncellenecek en az bir alan gönderilmeli.",
);

export type UpdateKnowledgeDocumentInput = z.infer<typeof updateKnowledgeDocumentSchema>;
