export type ScenePalette = {
  accent: string;
  accentStrong: string;
  amber: string;
  cool: string;
  wire: string;
  /** Neutral particle colour: slate on light, pale blue on dark. */
  point: string;
  pointOpacity: number;
  /** Additive blending lets dense regions glow on dark backgrounds. */
  additive: boolean;
};

/** SANSPHASE V2 particle colours. */
export const palettes: Record<"light" | "dark", ScenePalette> = {
  light: {
    accent: "#354cff",
    accentStrong: "#2230a7",
    amber: "#778aff",
    cool: "#87b6f0",
    wire: "#354cff",
    point: "#202b40",
    pointOpacity: 0.58,
    additive: false,
  },
  dark: {
    accent: "#9aaaff",
    accentStrong: "#c0cbff",
    amber: "#c2d9ff",
    cool: "#9dc7ef",
    wire: "#a3b4ff",
    point: "#dce6f7",
    pointOpacity: 0.56,
    additive: true,
  },
};
