import { getTranslations } from "next-intl/server";
import { createIntroScript } from "./intro-bootstrap";

export async function Preloader({ homePath }: { homePath: string }) {
  const t = await getTranslations("FX.common.preloader");
  return (
    <>
      <div className="fx-preloader" data-home-preloader aria-hidden="true">
        <div className="fx-pre-panel fx-pre-top" />
        <div className="fx-pre-panel fx-pre-bottom" />
        <div className="fx-pre-seam" />
        <div className="fx-pre-stage">
          <span className="fx-pre-corner" data-corner="tl" />
          <span className="fx-pre-corner" data-corner="tr" />
          <span className="fx-pre-corner" data-corner="bl" />
          <span className="fx-pre-corner" data-corner="br" />
          <p className="fx-pre-label">SANSPHASE / {t("label")}</p>
          <div className="fx-pre-mark grid place-items-center whitespace-nowrap font-display text-6xl leading-none font-semibold tracking-tight sm:text-7xl">
            <span className="bg-linear-to-r from-accent via-amber to-accent-strong bg-clip-text text-transparent" lang="zh-CN">
              無相
            </span>
          </div>
          <div className="fx-pre-meta">
            <progress className="fx-pre-bar" max={100} value={0} suppressHydrationWarning />
            <span className="fx-pre-count" suppressHydrationWarning>000</span>
            <span className="fx-pre-status">
              <span>{t("loading")}</span>
              <span>{t("ready")}</span>
            </span>
          </div>
        </div>
      </div>
      <script dangerouslySetInnerHTML={{ __html: createIntroScript(homePath) }} />
    </>
  );
}
