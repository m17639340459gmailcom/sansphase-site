const previousEntry = "sansphaseV3HasPreviousEntry";

function browserNavigation() {
  return (window as Window & { navigation?: { readonly canGoBack: boolean } }).navigation;
}

export function canGoBackInSite() {
  return browserNavigation()?.canGoBack ?? window.history.state?.[previousEntry] === true;
}

export function trackSiteBackHistory() {
  if (browserNavigation()) return;

  const history = window.history;
  const push = history.pushState;
  const replace = history.replaceState;
  let tracking = true;
  const mark = (data: unknown) => ({ ...(data && typeof data === "object" ? data : {}), [previousEntry]: true });

  // A push creates a same-document predecessor. Keep the marker on that entry
  // through replacements so Back/Forward can still distinguish it from a direct arrival.
  const markPush = (data: unknown, title: string, url?: string | URL | null) =>
    push.call(history, tracking ? mark(data) : data, title, url);
  const markReplace = (data: unknown, title: string, url?: string | URL | null) =>
    replace.call(history, tracking && history.state?.[previousEntry] === true ? mark(data) : data, title, url);

  history.pushState = markPush;
  history.replaceState = markReplace;
  return () => {
    tracking = false;
    if (history.pushState === markPush) history.pushState = push;
    if (history.replaceState === markReplace) history.replaceState = replace;
  };
}
