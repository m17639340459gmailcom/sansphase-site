/** Rendered inside <noscript>: without JS nothing may stay in a pre-animation state. */
export const FX_NOSCRIPT_CSS = [
  ".fx-preloader{display:none!important}",
  "[data-fx-state] .fx-u,[data-fx-state] .fx-line{animation:none!important;opacity:1!important;translate:none!important;scale:none!important;filter:none!important}",
  ".fx-scramble-vis{visibility:visible!important}",
  ".fx-draw path{animation:none!important;stroke-dashoffset:0!important}",
  ".fx-odo-col{animation:none!important;translate:0 calc(var(--n) * -1 * var(--fx-odo-h))!important}",
  "[data-reveal]{opacity:1!important;transform:none!important;clip-path:none!important}",
].join("");
