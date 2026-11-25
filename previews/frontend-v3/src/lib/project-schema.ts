import { z } from "zod";
import type { Project } from "@/data/projects";

const text = z.string().trim().min(1).max(4000);
const localized = z.object({ en: text, zh: text });
const url = z.url().max(500);
/** Local files under /public, or uploads in the Supabase `media` bucket. */
const imageSrc = z
  .string()
  .max(500)
  .regex(/^(\/[\w./-]+|https:\/\/[a-z0-9]+\.supabase\.co\/storage\/v1\/object\/public\/media\/[\w./-]+)\.(png|jpe?g|webp|avif|gif)$/i);

const image = z.object({
  src: imageSrc,
  alt: localized,
  width: z.number().int().positive().max(10000),
  height: z.number().int().positive().max(10000),
  caption: localized.optional(),
});

/** Mirrors the `Project` type in `src/data/projects.ts`; used for records edited in the admin. */
export const projectSchema: z.ZodType<Project> = z.object({
  slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(60),
  index: z.string().trim().min(1).max(4),
  title: localized,
  tagline: localized,
  description: localized,
  problem: localized,
  approach: localized,
  impact: localized,
  learning: localized.optional(),
  highlights: z.array(localized).max(12),
  role: localized,
  kind: localized,
  stage: z.object({ label: localized, tone: z.enum(["ready", "preview", "paused"]) }),
  year: z.string().trim().min(4).max(12),
  category: z.enum(["ai", "fullstack", "data", "fde"]),
  stack: z.array(z.string().trim().min(1).max(40)).max(20),
  links: z.object({
    github: url.optional(),
    githubPrivate: z.boolean().optional(),
    demo: url.optional(),
    download: url.optional(),
  }),
  article: z.object({ slug: z.string().regex(/^[a-z0-9-]+$/), label: localized }).optional(),
  cover: image.optional(),
  gallery: z.array(image).max(20).optional(),
  galleryNote: localized.optional(),
  notice: localized.optional(),
  featured: z.boolean().optional(),
  hue: z.number().min(0).max(360),
  motif: z.enum(["orbit", "grid", "wave", "stack", "graph", "prism"]),
  metrics: z.array(z.object({ value: z.string().trim().min(1).max(24), label: localized })).max(6),
});

/** Human-readable validation problems, one per line, for the admin editor. */
export function describeIssues(error: z.ZodError) {
  return error.issues.slice(0, 8).map((issue) => `${issue.path.join(".") || "(根)"}：${issue.message}`);
}
