export interface QuietRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Constellation input state. All dimensions are CSS pixels. */
export interface AstralState {
  /** Local opt-in cinematic study; omitted for the retained pure-space scene. */
  scene?: "atlas";
  width: number;
  height: number;
  time: number;
  /** Elapsed animation seconds for this frame; zero while motion is frozen. */
  deltaSeconds?: number;
  reducedMotion?: boolean;
  hover: number;
  /** Background-network hover position, in local CSS pixels. */
  pointerX?: number;
  pointerY?: number;
  quietRects: readonly QuietRect[];
}
