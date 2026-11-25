import { useEffect, useRef } from "react";
import { Box, Typography } from "@mui/material";
import { Title } from "react-admin";
import { useBlocker, useMatch } from "react-router-dom";
import { mountEmbeddedAuthorWorkspace } from "../author-entry.mjs";

declare const __SANSPHASE_ADMIN_PREVIEW__: boolean;
declare const __SANSPHASE_ADMIN_V3__: boolean;

const sections = new Set(["articles", "works", "resources", "software", "resource-center", "announcements"]);

export default function AuthorWorkspace() {
  const container = useRef<HTMLDivElement>(null);
  const workspace = useRef<ReturnType<typeof mountEmbeddedAuthorWorkspace>>(null);
  const kind = useMatch("/content/:kind")?.params.kind;
  const settings = useMatch("/site-settings");
  const section = settings ? "profile" : kind && sections.has(kind) ? kind : undefined;
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      currentLocation.pathname !== nextLocation.pathname && (workspace.current?.hasPendingWork() ?? false),
  );
  useEffect(() => {
    if (!container.current) return;
    const previewOrigin = __SANSPHASE_ADMIN_V3__ ? window.location.origin :
      __SANSPHASE_ADMIN_PREVIEW__ ? document.documentElement.dataset.v3PreviewOrigin : undefined;
    const mounted = mountEmbeddedAuthorWorkspace(container.current, section, previewOrigin);
    workspace.current = mounted;
    return () => {
      workspace.current = null;
      mounted.dispose();
    };
  }, [section]);
  useEffect(() => {
    if (blocker.state === "blocked") {
      if (workspace.current) workspace.current.confirmNavigation(blocker.proceed, blocker.reset);
      else blocker.reset();
    }
  }, [blocker]);

  return (
    <>
      <Title title="博客作者面板" />
      <Box
        data-author-host="admin-console"
        ref={container}
        sx={(theme) => ({
          mt: { xs: 3, md: 4 },
          minWidth: 0,
          width: "100%",
          maxWidth: 1160,
          "--text": theme.palette.text.primary,
          "--muted": theme.palette.text.secondary,
          "--dim": theme.palette.text.secondary,
          "--signal": theme.palette.primary.main,
          "--focus-edge": theme.palette.primary.main,
          "--body-link": theme.palette.primary.main,
          "--surface": theme.palette.background.paper,
          "--surface-2": theme.palette.background.default,
          "--line": theme.palette.divider,
          "--line-strong": theme.palette.divider,
          "--dialog-fill": theme.palette.background.paper,
          "--dialog-blur": "none",
          "--radius": `${theme.shape.borderRadius}px`,
          "--font": theme.typography.fontFamily,
          "--font-mono": "monospace",
          "--error": theme.palette.error.main,
          "--author-hover": theme.palette.action.selected,
          "--author-on-primary": theme.palette.primary.contrastText,
          colorScheme: theme.palette.mode,
        })}
      >
        <Typography className="author-workspace-loading" role="status" color="text.secondary">
          正在打开作者面板…
        </Typography>
      </Box>
    </>
  );
}
