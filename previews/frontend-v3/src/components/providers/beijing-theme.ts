type Theme = "light" | "dark";

export const beijingThemeStorageKey = "sansphase-v3-theme";
export const beijingThemeOverrideKey = "sansphase-v3-theme-override";
let inMemoryOverride: string | null = null;

// Also runs in the before-paint script. Keep it independent of browser globals.
export function resolveBeijingTheme(now: number, storedOverride: string | null) {
  const utcOffset = 8 * 60 * 60 * 1000;
  const clock = new Date(now + utcOffset);
  const hour = clock.getUTCHours();
  let theme: Theme = hour >= 6 && hour < 20 ? "light" : "dark";
  // After 20:00, hour 30 is 06:00 on the following Beijing day.
  const until = clock.setUTCHours(hour < 6 ? 6 : hour < 20 ? 20 : 30, 0, 0, 0) - utcOffset;
  if (storedOverride) {
    try {
      const choice: unknown = JSON.parse(storedOverride);
      if (choice && typeof choice === "object" && "until" in choice && choice.until === until &&
          "theme" in choice && (choice.theme === "light" || choice.theme === "dark")) theme = choice.theme;
    } catch { /* An invalid preference falls back to the schedule. */ }
  }
  return { theme, until };
}

function initializeBeijingTheme(resolve: typeof resolveBeijingTheme, themeKey: string, overrideKey: string) {
  let stored: string | null = null;
  try { stored = localStorage.getItem(overrideKey); } catch { /* Storage can be blocked. */ }
  const { theme } = resolve(Date.now(), stored);
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(theme);
  root.style.colorScheme = theme;
  try { localStorage.setItem(themeKey, theme); } catch { /* The HTML theme still applies. */ }
}

// Serialize only these self-contained functions and constant keys, never user input.
export const beijingThemeBootstrap = "(" + initializeBeijingTheme.toString() + ")(" +
  resolveBeijingTheme.toString() + "," + JSON.stringify(beijingThemeStorageKey) + "," +
  JSON.stringify(beijingThemeOverrideKey) + ")";

export function currentBeijingTheme() {
  let choice = inMemoryOverride;
  try { choice = localStorage.getItem(beijingThemeOverrideKey); } catch { /* Use this tab's choice. */ }
  return resolveBeijingTheme(Date.now(), choice);
}

export function rememberBeijingTheme(theme: Theme) {
  const { until } = resolveBeijingTheme(Date.now(), null);
  inMemoryOverride = JSON.stringify({ theme, until });
  try { localStorage.setItem(beijingThemeOverrideKey, inMemoryOverride); } catch { /* Use tab memory. */ }
}
