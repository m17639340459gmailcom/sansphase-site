import { z } from "zod";

export const contactTopics = ["fde", "ai", "contract", "collab", "other"] as const;

export const contactSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.email().max(200),
  company: z.string().trim().max(160).optional().or(z.literal("")),
  topic: z.enum(contactTopics),
  message: z.string().trim().min(20).max(5000),
  locale: z.enum(["en", "zh"]).default("en"),
  /** Honeypot — must stay empty. Bots love filling in every field. */
  website: z.string().max(0).optional().or(z.literal("")),
});

export type ContactInput = z.infer<typeof contactSchema>;
