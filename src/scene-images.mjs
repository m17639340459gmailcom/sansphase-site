import milkyWayPath from "./vendor/eso-milky-way/eso0932a.jpg";
import galacticPath from "./vendor/eso-galactic-centre/eso0934a.jpg";
import nebulaPath from "./vendor/eso-scene-photographs/eso1105a.jpg";
import galaxyPath from "./vendor/eso-scene-photographs/eso1424a.jpg";
import { sceneAssetUrl } from "./scene-delivery.mjs";

// The homepage's ESO photographs (sources, credits and licences are recorded
// beside each file in src/vendor). One list, shared by every scene layer.
export const [milkyWayURL, galacticURL, nebulaURL, galaxyURL] = [
  milkyWayPath,
  galacticPath,
  nebulaPath,
  galaxyPath,
].map((path) => sceneAssetUrl(path));

// Chapters 1-3, in order. `tint` is the display colour multiplier and
// `rate`/`phase` drive each photograph's slow idle drift.
export const chapterSkies = [
  { chapter: 1, name: "works-galactic-photograph", url: galacticURL, aspect: 4331 / 2480, tint: "#b9c8df", rate: 0.07, phase: 0 },
  { chapter: 2, name: "journal-nebula-photograph", url: nebulaURL, aspect: 4000 / 3876, tint: "#b1c5e0", rate: 0.06, phase: 1.3 },
  { chapter: 3, name: "community-galaxy-photograph", url: galaxyURL, aspect: 4000 / 3355, tint: "#9dafc9", rate: 0.05, phase: 2.6 },
];
