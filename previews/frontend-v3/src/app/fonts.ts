import { Bricolage_Grotesque, IBM_Plex_Mono, Instrument_Sans, Instrument_Serif, Noto_Sans_SC } from "next/font/google";
import localFont from "next/font/local";
import "./font-stack.css";

// The browser requests display, serif, and mono faces as their text is rendered.
// Preloading every weight in the root layout competes with first-paint CSS on slow links.
const display = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-display",
  axes: ["opsz", "wdth"],
  display: "swap",
  preload: false,
});

const sans = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const serif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-serif",
  display: "swap",
  preload: false,
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
  preload: false,
});

const zhUi = localFont({
  src: "./typefaces/noto-sans-sc-ui.woff2",
  variable: "--font-zh-ui",
  weight: "100 900",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
});

const zh = Noto_Sans_SC({
  variable: "--font-zh-full",
  display: "swap",
  preload: false,
});

/** Font CSS variables shared by the site and admin root layouts. */
export const fontVariables = `${display.variable} ${sans.variable} ${serif.variable} ${mono.variable} ${zhUi.variable} ${zh.variable}`;
