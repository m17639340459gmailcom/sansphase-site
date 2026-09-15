import React, { useState } from "react";
export { socialIcon, socialPlatform, tagTone } from "./blog-details.mjs";
export { applyCardAppearance } from "./glass-theme.mjs";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import * as ToggleGroup from "@radix-ui/react-toggle-group";
import * as Select from "@radix-ui/react-select";
import { Toaster, toast } from "sonner";
import A11yDialog from "a11y-dialog";
import { animate } from "motion";
import GlassSurface from "./vendor/react-bits/GlassSurface.jsx";
import {
  createElement,
  Menu,
  ArrowRight,
  ArrowLeft,
  Download,
  Plus,
  X,
  Search,
  FileText,
  Grid2X2,
  List,
  Link,
  Sun,
  Moon,
  CalendarDays,
  CloudSun,
  UserRound,
  Music2,
  Disc3,
  Tags,
  Bell,
  Clock3,
  ChevronDown,
  ChevronUp,
  Check,
  Image as ImageIcon,
} from "lucide";

const family = {
  menu: Menu,
  right: ArrowRight,
  left: ArrowLeft,
  download: Download,
  plus: Plus,
  close: X,
  search: Search,
  document: FileText,
  grid: Grid2X2,
  list: List,
  link: Link,
  sun: Sun,
  moon: Moon,
  calendar: CalendarDays,
  "cloud-sun": CloudSun,
  user: UserRound,
  music: Music2,
  disc: Disc3,
  tags: Tags,
  bell: Bell,
  clock: Clock3,
  "chevron-down": ChevronDown,
  "chevron-up": ChevronUp,
  check: Check,
  image: ImageIcon,
};
export const icon = (name, classes = "") =>
  createElement(family[name], {
    class: `ui-icon ${classes}`,
    "aria-hidden": "true",
    focusable: "false",
    "stroke-width": 1.6,
  }).outerHTML;
export const icons = Object.fromEntries(
  Object.keys(family).map((name) => [name, icon(name)]),
);
export const arrow = icon("right", "arrow");
export { toast };

export function mountToaster(container) {
  const root = createRoot(container);
  flushSync(() =>
    root.render(
      <Toaster
        position="bottom-center"
        theme="dark"
        closeButton
        duration={4000}
        toastOptions={{
          style: {
            background: "var(--dialog-fill)",
            backdropFilter: "var(--dialog-blur)",
            border: "1px solid rgb(224 237 255 / 42%)",
            color: "#eff4ff",
            fontFamily: "inherit",
          },
        }}
      />,
    ),
  );
  return () => {
    toast.dismiss();
    root.unmount();
  };
}

export function createDialog(container) {
  const dialog = new A11yDialog(container);
  const doc = container.ownerDocument;
  const priorInert = new Map();
  const setBackground = (value) => {
    doc.body.classList.toggle("dialog-open", value);
    for (const id of ["site-header", "home-stage", "main", "site-footer"]) {
      const node = doc.getElementById(id);
      if (node) {
        if (value) {
          priorInert.set(node, node.inert);
          node.inert = true;
        } else if (priorInert.has(node)) node.inert = priorInert.get(node);
      }
    }
    if (!value) priorInert.clear();
  };
  const show = dialog.show.bind(dialog);
  dialog.show = (event) => {
    const wasShown = dialog.shown;
    show(event);
    if (!wasShown && dialog.shown) setBackground(true);
    return dialog;
  };
  dialog.on("hide", () => setBackground(false));
  dialog.on("destroy", () => setBackground(false));
  return dialog;
}

let entrance;
export function enterPage(element) {
  entrance?.stop();
  if (!element || matchMedia("(prefers-reduced-motion: reduce)").matches)
    return;
  entrance = animate(
    element,
    { opacity: [0, 1], y: [12, 0] },
    { duration: 0.45, ease: [0.22, 0.8, 0.22, 1] },
  );
}

// Small adapters keep the existing content controller while Radix owns focus,
// keyboard selection and control state. Content and labels are site data.
export function mountFilters(container, options) {
  const root = createRoot(container);
  const update = (value = options.value) =>
    flushSync(() =>
      root.render(
        <ToggleGroup.Root
          type="single"
          className="filters"
          value={value}
          aria-label={options.label}
          onValueChange={(next) => {
            if (next) options.onChange(next);
          }}
        >
          {options.items.map((item) => (
            <ToggleGroup.Item
              key={item.value}
              value={item.value}
              className="filter"
              data-category={item.value}
            >
              {item.label}
            </ToggleGroup.Item>
          ))}
        </ToggleGroup.Root>,
      ),
    );
  update();
  return { update, dispose: () => root.unmount() };
}

// React Bits GlassSurface is the source of the visual card surface. The
// existing content renderer can keep its semantic anchors and article markup;
// this adapter mounts the published component inside each existing card.
export function mountGlassSurface(container, html, className = "") {
  const root = createRoot(container);
  flushSync(() =>
    root.render(
      <GlassSurface
        width="100%"
        height="auto"
        borderRadius={0}
        borderWidth={0}
        brightness={28}
        opacity={0}
        blur={8}
        displace={0}
        backgroundOpacity={0}
        saturation={1.12}
        distortionScale={-70}
        className={`blog-third-party-glass ${className}`}
      >
        <div
          className="blog-third-party-glass-content"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </GlassSurface>,
    ),
  );
  return () => root.unmount();
}

function TimezoneSelect({ value: initialValue, items, label, onChange }) {
  const [value, setValue] = useState(initialValue);
  const glyph = (name) => <span aria-hidden="true" dangerouslySetInnerHTML={{ __html: icons[name] }} />;
  return (
    <Select.Root value={value} onValueChange={(next) => { setValue(next); onChange(next); }}>
      <Select.Trigger id="blog-timezone" className="timezone-select" aria-label={label}>
        <Select.Value />
        <Select.Icon>{glyph("chevron-down")}</Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content className="blog-timezone-menu" position="popper" sideOffset={6} collisionPadding={12}
          onEscapeKeyDown={(event) => event.stopPropagation()}>
          <Select.ScrollUpButton className="timezone-scroll">{glyph("chevron-up")}</Select.ScrollUpButton>
          <Select.Viewport className="timezone-options">
            {items.map(([key, text]) => (
              <Select.Item key={key} value={key} className="timezone-option">
                <Select.ItemText>{text}</Select.ItemText>
                <Select.ItemIndicator>{glyph("check")}</Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
          <Select.ScrollDownButton className="timezone-scroll">{glyph("chevron-down")}</Select.ScrollDownButton>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}
export function mountTimezoneSelect(container, options) {
  const root = createRoot(container);
  flushSync(() => root.render(<TimezoneSelect {...options} />));
  return () => root.unmount();
}

export {enhanceArticleReading} from './article-reading.mjs';

