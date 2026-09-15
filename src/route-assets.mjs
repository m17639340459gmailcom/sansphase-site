import { parseRoute } from "./core.mjs";

// Visitor startup must not download the private writing interface. Its existing
// click handler is installed before replaying the first requested action.
export function mountRouteAssets(
  win,
  {
    loadAuthor = () => import("./author.bundle.mjs"),
    loadBackground = () => import("./blog-galaxy.mjs"),
  } = {},
) {
  const doc = win.document;
  let background,
    author,
    authorReady = false,
    pendingClick = false,
    disposed = false;
  const route = () => {
    if (
      ![
        "notes",
        "note",
        "works",
        "work",
        "resources",
        "software",
        "resource-center",
      ].includes(parseRoute(win.location.hash).page)
    )
      return;
    if (!background)
      background = Promise.resolve()
        .then(loadBackground)
        .catch(() => {
          background = null;
        });
  };
  const click = async (event) => {
    const button = event.target.closest?.(
      "[data-author-login],[data-author-open]",
    );
    if (!button || authorReady) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (pendingClick) return;
    pendingClick = true;
    const label = button.textContent;
    button.setAttribute("aria-busy", "true");
    button.textContent = "正在准备…";
    try {
      if (!author) author = loadAuthor();
      await author;
      authorReady = true;
      if (!disposed && button.isConnected) {
        button.textContent = label;
        button.removeAttribute("aria-busy");
        button.click();
      }
    } catch {
      author = null;
      if (button.isConnected) button.title = "登录组件加载失败，点击重试";
    } finally {
      pendingClick = false;
      if (button.isConnected) {
        button.textContent = label;
        button.removeAttribute("aria-busy");
      }
    }
  };
  doc.addEventListener("click", click, true);
  win.addEventListener("hashchange", route);
  route();
  return () => {
    disposed = true;
    doc.removeEventListener("click", click, true);
    win.removeEventListener("hashchange", route);
  };
}
