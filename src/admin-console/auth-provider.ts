import type { AuthProvider } from "react-admin";
import { adminLoginHref, consoleSection } from "../admin-console-navigation.ts";

declare const __SANSPHASE_ADMIN_PREVIEW__: boolean;
const authError = (message: string, status: number) =>
  Object.assign(Error(message), { status });
const denied = (error: unknown) =>
  Boolean(
    error &&
    typeof error === "object" &&
    "status" in error &&
    (error.status === 401 || error.status === 403),
  );

async function identity(): Promise<{ name: string }> {
  let response: Response;
  try {
    response = await fetch("/api/author/session", {
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw authError("暂时无法连接服务器，请重试。", 0);
  }
  if (response.status === 401 || response.status === 403)
    throw authError("请先登录作者账号。", response.status);
  if (!response.ok)
    throw authError("暂时无法核实登录状态，请重试。", response.status);
  let user: unknown;
  try {
    user = await response.json();
  } catch {
    throw authError("登录状态响应异常，请重试。", 502);
  }
  // The existing session contract uses HTTP 200 + null for guests/readers.
  if (user === null) throw authError("请先登录作者账号。", 401);
  if (
    !user ||
    typeof user !== "object" ||
    !("name" in user) ||
    typeof user.name !== "string"
  )
    throw authError("登录状态响应异常，请重试。", 502);
  return { name: user.name };
}

export const createConsoleAuthProvider = (
  clearIdentityCache: () => void,
  mainFrontend: "v1" | "v2" | "v3" = "v1",
): AuthProvider => {
  let sessionDenied = false,
    generation = 0;
  let section = consoleSection(
    typeof window === "undefined" ? "" : window.location.hash,
  );
  const rememberSection = () => {
    const path = window.location.hash.split("?")[0];
    if (
      [
        "#/readers",
        "#/memberships",
        "#/profile-reviews",
        "#/maintenance",
        "#/activity",
      ].includes(path)
    )
      section = consoleSection(path);
  };
  const loginDestination = () =>
    typeof __SANSPHASE_ADMIN_PREVIEW__ !== "undefined" &&
    __SANSPHASE_ADMIN_PREVIEW__
      ? "/preview-login"
      : adminLoginHref(section, mainFrontend);
  const invalidate = () => {
    generation++;
    clearIdentityCache();
    window.dispatchEvent(new CustomEvent("author:identity", { detail: null }));
  };
  const verify = async () => {
    rememberSection();
    const current = generation;
    try {
      const user = await identity();
      if (current !== generation)
        throw authError("登录状态已变化，请重新登录。", 401);
      sessionDenied = false;
      return user;
    } catch (error) {
      if (current !== generation && sessionDenied)
        error = authError("登录状态已变化，请重新登录。", 401);
      if (denied(error)) {
        sessionDenied = true;
        if (current === generation) invalidate();
      }
      throw Object.assign(
        error instanceof Error ? error : Error("登录状态检查失败，请重试。"),
        {
          redirectTo: sessionDenied
            ? new URL(loginDestination(), window.location.origin).href
            : "/session-unavailable?section=" + section,
        },
      );
    }
  };
  return {
    login: async () => {
      rememberSection();
      window.location.assign(loginDestination());
    },
    logout: async (params?: { userInitiated?: boolean }) => {
      rememberSection();
      // Only the explicit user action may revoke the server session. React-admin
      // also invokes this method after failed auth checks, which can overlap a
      // successful getIdentity request; that race must never log the user out.
      if (!params?.userInitiated)
        return sessionDenied
          ? new URL(loginDestination(), window.location.origin).href
          : "/session-unavailable?section=" + section;
      {
        let response: Response;
        try {
          response = await fetch("/api/author/logout", {
            method: "POST",
            credentials: "same-origin",
            redirect: "error",
            signal: AbortSignal.timeout(10000),
            headers: {
              "Content-Type": "application/json",
              "X-Author-Request": "1",
            },
            body: "{}",
          });
        } catch {
          throw Error("退出失败，请重试。");
        }
        if (!response.ok && response.status !== 401)
          throw Error("退出失败，请重试。");
        invalidate();
      }
      // React-admin clears its query/store cache before following an absolute
      // same-origin destination; a relative / URL would stay in its hash router.
      return new URL(loginDestination(), window.location.origin).href;
    },
    checkAuth: async () => {
      await verify();
    },
    checkError: async (error: { status?: number }) => {
      if (denied(error)) {
        rememberSection();
        sessionDenied = true;
        invalidate();
        throw Object.assign(authError("登录状态失效", error.status || 401), {
          redirectTo: new URL(loginDestination(), window.location.origin).href,
        });
      }
    },
    getIdentity: async () => ({
      id: "site-owner",
      fullName: (await verify()).name,
    }),
    getPermissions: async () => "owner",
  };
};
