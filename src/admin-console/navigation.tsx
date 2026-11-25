import { useEffect } from "react";
import { Button } from "@mui/material";
import {
  adminAuthorPanelHref,
  adminMainSiteHref,
} from "../admin-console-navigation.ts";

type NavigationProps = { preview: boolean; mainFrontend?: "v1" | "v2" | "v3" };

const editingTarget = "input:not([type=button], [type=submit], [type=reset], [type=checkbox], [type=radio]), textarea, select";
const openModal = "dialog[open], [aria-modal=true]:not([hidden], [aria-hidden=true]), .MuiModal-root:not(.MuiModal-hidden)";

export function backOnEscape(event: KeyboardEvent) {
  if (event.key !== "Escape" || event.defaultPrevented || event.repeat || event.isComposing || event.keyCode === 229 ||
    event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || document.fullscreenElement) return;
  const target = event.target;
  if (target instanceof HTMLElement && (target.isContentEditable || target.closest(editingTarget))) return;
  if (document.querySelector(openModal)) return;

  const navigation = (window as Window & { navigation?: { readonly canGoBack: boolean } }).navigation;
  // React Router starts its own hash navigation at index zero. Fall back only after it has added a console entry.
  const index: unknown = window.history.state?.idx;
  if (!(navigation?.canGoBack ?? (typeof index === "number" && Number.isInteger(index) && index > 0))) return;
  event.preventDefault();
  // Native traversal goes through React Router's existing unsaved-work blocker.
  window.history.back();
}

export function ConsoleReturnLink({
  preview,
  mainFrontend,
  href = adminMainSiteHref(preview, mainFrontend),
}: NavigationProps & { href?: string }) {
  return (
    <Button
      href={href}
      sx={{
        display: "inline-flex",
        flexShrink: 0,
        minWidth: 0,
        px: { xs: 1, sm: 2 },
        whiteSpace: "nowrap",
      }}
    >
      返回主站
    </Button>
  );
}

export function OriginalAuthorPanel({
  preview,
  mainFrontend,
}: NavigationProps) {
  const href = adminAuthorPanelHref(preview, mainFrontend);
  useEffect(() => {
    window.location.replace(href);
  }, [href]);
  return <Button href={href}>打开博客作者面板</Button>;
}
