import "server-only";
import { revalidatePath, revalidateTag } from "next/cache";
import { POSTS_TAG } from "./blog";
import { PROJECTS_TAG } from "./projects";

/** After a post changes: the blog index, every post page, the home page and the admin list. */
export function revalidatePosts() {
  revalidateTag(POSTS_TAG, "max");
  revalidatePath("/[locale]", "page");
  revalidatePath("/[locale]/blog", "page");
  revalidatePath("/[locale]/blog/[slug]", "page");
  revalidatePath("/sitemap.xml");
  revalidatePath("/admin/posts", "layout");
}

/** After a project changes: the project index, every case study, the home page and the admin list. */
export function revalidateProjects() {
  revalidateTag(PROJECTS_TAG, "max");
  revalidatePath("/[locale]", "page");
  revalidatePath("/[locale]/projects", "page");
  revalidatePath("/[locale]/projects/[slug]", "page");
  revalidatePath("/sitemap.xml");
  revalidatePath("/admin/projects", "layout");
}
