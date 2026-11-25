import { notFound } from "next/navigation";

/** Catch-all so unknown paths inside a locale render the localized 404. */
export default function CatchAllPage() {
  notFound();
}
