import "server-only";
import { unstable_cache } from "next/cache";
import { projects as fileProjects, type Project } from "@/data/projects";
import { projectSchema } from "./project-schema";
import { publicSupabase } from "./supabase/public";

/** Cache tag for projects stored in the database; admin saves revalidate it. */
export const PROJECTS_TAG = "projects";

type StoredProject = { slug: string; data: unknown; sort: number };

const readStoredProjects = unstable_cache(
  async (): Promise<StoredProject[]> => {
    const supabase = publicSupabase();
    if (!supabase) return [];
    const { data, error } = await supabase.from("projects").select("slug, data, sort").eq("published", true).order("sort");
    return error || !data ? [] : (data as StoredProject[]);
  },
  ["projects", "published"],
  { tags: [PROJECTS_TAG], revalidate: 3600 },
);

/**
 * All projects: the records in `src/data/projects.ts`, with any published database record of the
 * same slug taking its place, followed by database-only projects. Invalid records are skipped so a
 * bad edit can never break the site.
 */
export async function getProjects(): Promise<Project[]> {
  let stored: StoredProject[] = [];
  try {
    stored = await readStoredProjects();
  } catch {
    stored = [];
  }
  const valid = new Map<string, Project>();
  for (const row of stored) {
    const parsed = projectSchema.safeParse(row.data);
    if (parsed.success && parsed.data.slug === row.slug) valid.set(row.slug, parsed.data);
  }
  const merged = fileProjects.map((project) => valid.get(project.slug) ?? project);
  const known = new Set(fileProjects.map((project) => project.slug));
  for (const [slug, project] of valid) if (!known.has(slug)) merged.push(project);
  return merged;
}

export async function getFeaturedProjects() {
  return (await getProjects()).filter((project) => project.featured);
}

export async function getProject(slug: string) {
  return (await getProjects()).find((project) => project.slug === slug);
}

/** The project, the one after it (wrapping around), its 1-based position and the total. */
export async function getProjectContext(slug: string) {
  const all = await getProjects();
  const index = all.findIndex((project) => project.slug === slug);
  if (index === -1) return null;
  return { project: all[index], next: all[(index + 1) % all.length], position: index + 1, total: all.length };
}
