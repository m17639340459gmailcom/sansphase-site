import { lazy, useEffect } from "react";
import { createRoot } from "react-dom/client";
import {
  Admin,
  Resource,
  Layout,
  AppBar,
  Menu,
  TitlePortal,
  ToggleThemeButton,
  LoadingIndicator,
  Logout,
  UserMenu,
  localStorageStore,
  CustomRoutes,
  Authenticated,
  useLogout,
  useNotify,
} from "react-admin";
import type { AppBarProps, LayoutProps } from "react-admin";
import { Box, Typography, Chip, Stack, Button } from "@mui/material";
import { Route, useLocation } from "react-router-dom";
import PeopleOutlineIcon from "@mui/icons-material/PeopleOutline";
import WorkspacePremiumOutlinedIcon from "@mui/icons-material/WorkspacePremiumOutlined";
import FactCheckOutlinedIcon from "@mui/icons-material/FactCheckOutlined";
import ArticleOutlinedIcon from "@mui/icons-material/ArticleOutlined";
import CleaningServicesOutlinedIcon from "@mui/icons-material/CleaningServicesOutlined";
import HistoryOutlinedIcon from "@mui/icons-material/HistoryOutlined";
import DashboardOutlinedIcon from "@mui/icons-material/DashboardOutlined";
import { createAdminConsoleDataProvider } from "./data-provider.ts";
import { createConsoleAuthProvider } from "./auth-provider.ts";
import { i18nProvider } from "./i18n.ts";
import { consoleTheme } from "./theme.ts";
import { ReaderList } from "./readers.tsx";
import { ProfileReviewList } from "./reviews.tsx";
import { RedesignDashboard } from "./redesign-dashboard.tsx";
import { MaintenancePage, ActivityPage } from "./maintenance.tsx";
import { backOnEscape, ConsoleReturnLink, OriginalAuthorPanel } from "./navigation.tsx";
import {
  adminConsoleHref,
  adminLoginHref,
} from "../admin-console-navigation.ts";
import "./console.css";

declare const __SANSPHASE_ADMIN_PREVIEW__: boolean;
declare const __SANSPHASE_ADMIN_REDESIGN__: boolean;
declare const __SANSPHASE_ADMIN_V3__: boolean;
const preview =
  typeof __SANSPHASE_ADMIN_PREVIEW__ !== "undefined" &&
  __SANSPHASE_ADMIN_PREVIEW__;
const redesign = __SANSPHASE_ADMIN_REDESIGN__;
const appBarHeight = redesign ? 60 : 68;
const AuthorWorkspace = __SANSPHASE_ADMIN_REDESIGN__
  ? lazy(() => import("./author-workspace.tsx"))
  : null;
// The server selects the document entry; URL parameters never choose a mode.
const frontendVersion = document.documentElement.dataset.mainFrontend;
const mainFrontend = frontendVersion === "v2" || frontendVersion === "v3" ? frontendVersion : "v1";

function ConsoleLogout() {
  const logout = useLogout(),
    notify = useNotify();
  return (
    <Logout
      onClick={() => {
        void logout({ userInitiated: true }, undefined, false).catch(() =>
          notify("退出失败，请重试。", { type: "error" }),
        );
      }}
    />
  );
}

function ConsoleAppBar({ alwaysOn }: AppBarProps) {
  return (
    <AppBar
      alwaysOn={alwaysOn}
      color="inherit"
      elevation={0}
      userMenu={
        <UserMenu>
          <ConsoleLogout />
        </UserMenu>
      }
      toolbar={
        <>
          <ConsoleReturnLink
            preview={preview}
            mainFrontend={mainFrontend}
            href={__SANSPHASE_ADMIN_PREVIEW__ && __SANSPHASE_ADMIN_REDESIGN__ ? "http://localhost:4308/" : undefined}
          />
          <ToggleThemeButton />
          {redesign ? (
            <Box sx={{ display: "flex", "@media (max-width: 360px)": { display: "none" } }}>
              <LoadingIndicator />
            </Box>
          ) : <LoadingIndicator />}
        </>
      }
      sx={{
        borderBottom: 1,
        borderColor: "divider",
        "& .RaAppBar-toolbar": { minHeight: redesign ? appBarHeight - 1 : appBarHeight },
        "& .RaAppBar-menuButton": { mr: 1 },
        ...(redesign && { bgcolor: "background.paper", backgroundImage: "none" }),
      }}
    >
      <Typography
        className={redesign ? undefined : "console-monogram"}
        sx={{
          fontSize: redesign ? { xs: 16, sm: 19 } : 21,
          fontWeight: redesign ? 750 : 700,
          mr: { xs: 1, sm: 2 },
          flexShrink: 0,
        }}
      >
        無相
        {redesign && <Box component="span" sx={{ display: { xs: "none", sm: "inline" } }}>管理台</Box>}
      </Typography>
      <TitlePortal
        sx={{
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontSize: 13,
          color: "text.secondary",
          ...(redesign && { display: { xs: "none", sm: "block" }, borderLeft: 1, borderColor: "divider", pl: 2 }),
        }}
      />
      {typeof __SANSPHASE_ADMIN_PREVIEW__ !== "undefined" &&
        __SANSPHASE_ADMIN_PREVIEW__ && (
          <Chip
            label="本地预览"
            size="small"
            variant="outlined"
            sx={{ mr: 1 }}
            {...(redesign && { color: "primary" })}
          />
        )}
      {redesign && <Box sx={{ display: { xs: "block", sm: "none" }, flex: 1 }} />}
    </AppBar>
  );
}
function ConsoleMenu() {
  return (
    <Box
      className={redesign ? "console-sidebar-redesign" : undefined}
      sx={{ pt: redesign ? 2 : 3, px: 1.5 }}
    >
      {!redesign && (
        <Typography variant="overline" color="text.secondary" sx={{ px: 2 }}>
          管理工作台
        </Typography>
      )}
      <Menu
        sx={{
          mt: 1,
          "& .RaMenuItemLink-root": { borderRadius: 1, py: redesign ? 0.95 : 1.3, mb: 0.5 },
          "& .RaMenuItemLink-active": {
            bgcolor: "action.selected",
            color: "primary.main",
            ...(redesign && { "& .RaMenuItemLink-icon": { color: "inherit" }, fontWeight: 650 }),
          },
        }}
      >
        {redesign && (
          <Menu.Item to="/" primaryText="管理概览" leftIcon={<DashboardOutlinedIcon />} />
        )}
        <Menu.Item
          to="/author-panel"
          primaryText="博客作者面板"
          leftIcon={<ArticleOutlinedIcon />}
        />
        <Typography
          variant="overline"
          color="text.secondary"
          sx={{ display: "block", px: 2, pt: 2 }}
        >
          用户与会员
        </Typography>
        <Menu.ResourceItems />
        <Typography
          variant="overline"
          color="text.secondary"
          sx={{ display: "block", px: 2, pt: 2 }}
        >
          维护与记录
        </Typography>
        <Menu.Item
          to="/maintenance"
          primaryText="清理与维护"
          leftIcon={<CleaningServicesOutlinedIcon />}
        />
        <Menu.Item
          to="/activity"
          primaryText="账号操作记录"
          leftIcon={<HistoryOutlinedIcon />}
        />
      </Menu>
      {typeof __SANSPHASE_ADMIN_PREVIEW__ !== "undefined" &&
        __SANSPHASE_ADMIN_PREVIEW__ && (
          <Box
            className={redesign ? "console-sidebar-preview-note" : undefined}
            sx={{ mx: 2, mt: 5, pt: 2, borderTop: 1, borderColor: "divider" }}
          >
            <Typography variant="caption" color="text.secondary">
              当前使用演示数据
            </Typography>
            <Typography
              variant="caption"
              color="text.secondary"
              display="block"
              mt={0.5}
            >
              操作仅在本机预览中生效
            </Typography>
          </Box>
        )}
    </Box>
  );
}
function ConsoleLayout(props: LayoutProps) {
  return (
    <Layout
      {...props}
      appBar={ConsoleAppBar}
      appBarAlwaysOn={redesign}
      menu={ConsoleMenu}
      sx={{
        minWidth: 0,
        "& .RaLayout-appFrame": { mt: `${appBarHeight}px` },
        "& .RaLayout-content": {
          px: { xs: 1.5, md: 4 },
          pb: 4,
          maxWidth: redesign ? 1440 : 1700,
          width: "100%",
          marginInline: "auto",
          minWidth: 0,
        },
        "& .RaList-root, & .RaList-main, & .RaList-content": {
          minWidth: 0,
          maxWidth: "100%",
        },
        "& .RaSidebar-fixed": {
          borderRight: 1,
          borderColor: "divider",
          height: redesign ? `calc(100dvh - ${appBarHeight}px)` : "calc(100vh - 68px)",
          overflowY: "auto",
          ...(redesign && { bgcolor: "background.paper", width: "inherit" }),
        },
        ...(redesign && {
          "& .RaSidebar-docked": { height: `calc(100dvh - ${appBarHeight}px)` },
          "& :is(a, button):focus-visible": { outlineColor: "primary.main" },
          "& .console-table": {
            scrollbarColor: (theme) => `${theme.palette.divider} transparent`,
          },
        }),
      }}
    />
  );
}
function ConsoleLogin() {
  const location = useLocation();
  const state: unknown = location.state;
  const next =
    state &&
    typeof state === "object" &&
    "nextPathname" in state &&
    typeof state.nextPathname === "string"
      ? state.nextPathname
      : window.location.hash;
  const href =
    typeof __SANSPHASE_ADMIN_PREVIEW__ !== "undefined" &&
    __SANSPHASE_ADMIN_PREVIEW__
      ? "/preview-login"
      : adminLoginHref(next, mainFrontend);
  useEffect(() => {
    window.location.replace(href);
  }, [href]);
  return (
    <Stack
      alignItems="center"
      justifyContent="center"
      sx={{ minHeight: "100dvh" }}
    >
      <Typography>
        {typeof __SANSPHASE_ADMIN_PREVIEW__ !== "undefined" &&
        __SANSPHASE_ADMIN_PREVIEW__
          ? "正在打开演示登录…"
          : "正在打开账号登录…"}
      </Typography>
      <Button href={href}>打开登录页面</Button>
    </Stack>
  );
}
function SessionUnavailable() {
  const location = useLocation();
  const href = adminConsoleHref(
    new URLSearchParams(location.search).get("section") || "readers",
  );
  return (
    <Stack
      alignItems="center"
      justifyContent="center"
      spacing={2}
      sx={{ minHeight: "100dvh", p: 3 }}
    >
      <Typography role="alert">暂时无法核实登录状态，请重试。</Typography>
      <Button
        variant="outlined"
        href={href}
        onClick={(event) => {
          event.preventDefault();
          window.history.replaceState(window.history.state, "", href);
          window.location.reload();
        }}
      >
        重试
      </Button>
    </Stack>
  );
}
function MembershipList() {
  return <ReaderList membership redesign={redesign} />;
}
function RedesignedReaderList() {
  return <ReaderList redesign />;
}
function ConsoleAuthorSection() {
  return (
    <Authenticated>
      {AuthorWorkspace ? <AuthorWorkspace /> : (
        <OriginalAuthorPanel preview={preview} mainFrontend={mainFrontend} />
      )}
    </Authenticated>
  );
}
const root = document.getElementById("root");
if (!root) throw Error("Missing admin console root");
if (__SANSPHASE_ADMIN_V3__) window.addEventListener("keydown", backOnEscape);
const dataProvider = createAdminConsoleDataProvider();
createRoot(root).render(
  <Admin
    dataProvider={dataProvider}
    authProvider={createConsoleAuthProvider(dataProvider.clearIdentityCache, mainFrontend)}
    requireAuth
    loginPage={ConsoleLogin}
    dashboard={__SANSPHASE_ADMIN_REDESIGN__ ? RedesignDashboard : undefined}
    layout={ConsoleLayout}
    i18nProvider={i18nProvider}
    theme={consoleTheme("light", redesign)}
    darkTheme={consoleTheme("dark", redesign)}
    defaultTheme="light"
    store={localStorageStore(
      "1",
      __SANSPHASE_ADMIN_V3__
        ? "sansphase-admin-v3"
        : __SANSPHASE_ADMIN_REDESIGN__ ? "sansphase-admin-redesign-local"
        : __SANSPHASE_ADMIN_PREVIEW__ ? "sansphase-admin-local" : "sansphase-admin",
    )}
    disableTelemetry
  >
    <CustomRoutes noLayout>
      <Route path="/session-unavailable" element={<SessionUnavailable />} />
    </CustomRoutes>
    <CustomRoutes>
      <Route path="/author-panel" element={<ConsoleAuthorSection />} />
      <Route path="/content" element={<ConsoleAuthorSection />} />
      <Route path="/content/:kind" element={<ConsoleAuthorSection />} />
      <Route path="/site-settings" element={<ConsoleAuthorSection />} />
      <Route
        path="/maintenance"
        element={
          <Authenticated>
            <MaintenancePage />
          </Authenticated>
        }
      />
      <Route
        path="/activity"
        element={
          <Authenticated>
            <ActivityPage />
          </Authenticated>
        }
      />
    </CustomRoutes>
    <Resource
      name="readers"
      options={{ label: "用户管理" }}
      list={redesign ? RedesignedReaderList : ReaderList}
      icon={PeopleOutlineIcon}
    />
    <Resource
      name="memberships"
      options={{ label: "VIP 会员" }}
      list={MembershipList}
      icon={WorkspacePremiumOutlinedIcon}
    />
    <Resource
      name="profile-reviews"
      options={{ label: "资料审核" }}
      list={ProfileReviewList}
      icon={FactCheckOutlinedIcon}
    />
  </Admin>,
);
