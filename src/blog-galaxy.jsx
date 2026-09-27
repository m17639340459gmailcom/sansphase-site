import { createElement, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import Galaxy from "./vendor/react-bits/Galaxy.jsx";
import { observeBackgroundPlayback } from "./background-playback.mjs";

// Stable arrays keep Galaxy's material and context intact when paused changes.
const focal = [0.5, 0.48], rotation = [1, 0];
function BlogBackground() {
  const [paused, setPaused] = useState(() => document.hidden || !document.body.classList.contains("blog-open"));
  useEffect(() => observeBackgroundPlayback(document, setPaused), []);
  return createElement(Galaxy, {
    paused, focal, rotation,
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
  });
}

const host = document.getElementById("blog-galaxy-field");
if (host) {
  createRoot(host).render(
    createElement(BlogBackground),
  );
}
