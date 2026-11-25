/** Fired on `document`; the command palette listens for it. */
export const COMMAND_OPEN_EVENT = "tdx:command-open";

export type CommandOpenDetail = {
  /** Optional text to prefill the palette's search field with. */
  query?: string;
};

/** Opens the command palette from anywhere (buttons, shortcuts, easter eggs). */
export function openCommandPalette(detail: CommandOpenDetail = {}) {
  document.dispatchEvent(new CustomEvent<CommandOpenDetail>(COMMAND_OPEN_EVENT, { detail }));
}

/** Subscribes to open requests; returns the unsubscribe function. */
export function onCommandOpen(handler: (detail: CommandOpenDetail) => void) {
  const listener = (event: Event) => handler((event as CustomEvent<CommandOpenDetail>).detail ?? {});
  document.addEventListener(COMMAND_OPEN_EVENT, listener);
  return () => document.removeEventListener(COMMAND_OPEN_EVENT, listener);
}
