import { createElement } from "react";
import { createRoot } from "react-dom/client";
import Galaxy from "./vendor/react-bits/Galaxy.jsx";

const host = document.getElementById("blog-galaxy-field");
if (host) {
  createRoot(host).render(
    createElement(Galaxy, {
      transparent: true,
      mouseInteraction: false,
      mouseRepulsion: false,
      density: 1.15,
      starSpeed: 0.42,
      speed: 0.8,
      hueShift: 205,
      glowIntensity: 0.42,
      saturation: 0.42,
      twinkleIntensity: 0.56,
      rotationSpeed: 0.018,
      focal: [0.5, 0.48],
    }),
  );
}
