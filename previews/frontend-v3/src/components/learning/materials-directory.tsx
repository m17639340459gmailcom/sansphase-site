"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import archiveCover from "../../../public/images/demo-editorial/archive-detail.webp";
import filmCover from "../../../public/images/demo-editorial/film-detail.webp";
import starWindowCover from "../../../public/images/demo-editorial/star-window.webp";
import { CatalogCard, CatalogCardGrid } from "@/components/catalog/catalog-card";
import { localize } from "@/data/sansphase";
import { materialDownloadHref, sansphaseMaterials } from "@/data/sansphase-materials";
import { cn } from "@/lib/utils";

type MaterialId = (typeof sansphaseMaterials)[number]["id"];

const covers = { "learning-journal": filmCover, "project-checklist": starWindowCover, "source-index": archiveCover };

export function MaterialsDirectory() {
  const t = useTranslations("Learning");
  const locale = useLocale();
  const [category, setCategory] = useState<MaterialId | "all">("all");
  const options = ["all", ...sansphaseMaterials.map(({ id }) => id)] as const;
  const entries = sansphaseMaterials.filter(({ id }) => category === "all" || category === id);

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label={t("filterLabel")} className="flex flex-wrap gap-2">
          {options.map((id) => (
            <button
              key={id}
              className={cn(
                "min-h-11 rounded-full border px-4 text-sm transition-colors",
                id === category ? "border-accent/40 bg-accent-soft text-accent" : "border-line text-muted hover:border-line-strong hover:text-fg",
              )}
              type="button"
              aria-pressed={category === id}
              onClick={() => setCategory(id)}
            >
              {t(`filter.${id}`)}
            </button>
          ))}
        </div>
        <p role="status" className="font-mono text-xs text-muted">{t("count", { count: entries.length })}</p>
      </div>

      <CatalogCardGrid>
        {entries.map((material) => {
          const title = localize(material.title, locale);
          return (
            <CatalogCard key={material.id} href={material.detailHref} title={title} summary={localize(material.summary, locale)}
              image={covers[material.id]} label={t("previewNamed", { title })}
              download={{ href: materialDownloadHref(material.id, locale), label: t("downloadNamed", { title }) }} />
          );
        })}
      </CatalogCardGrid>
    </>
  );
}
