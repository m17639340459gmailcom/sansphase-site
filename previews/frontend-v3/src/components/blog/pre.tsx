"use client";

import { Copy } from "lucide-react";
import { useTranslations } from "next-intl";
import { isValidElement, useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { burst } from "./burst";

const LANGUAGE_LABELS: Record<string, string> = {
  plaintext: "text",
  markdown: "md",
  typescript: "ts",
  javascript: "js",
  shell: "sh",
  bash: "sh",
};

/** rehype-pretty-code marks every line with `data-line`; counted from the element tree so SSR shows it too. */
function countLines(node: ReactNode): number {
  if (Array.isArray(node)) return node.reduce<number>((sum, child) => sum + countLines(child), 0);
  if (!isValidElement<{ children?: ReactNode; "data-line"?: unknown }>(node)) return 0;
  if (node.props["data-line"] !== undefined) return 1;
  return countLines(node.props.children);
}

/**
 * Every MDX code block: an editor-style bar with the language, line count and a copy button that
 * morphs clipboard -> drawn check (with a small burst) on success.
 */
export function Pre({ children, ...props }: ComponentProps<"pre">) {
  const t = useTranslations("FX.blog");
  const tc = useTranslations("Common");
  const cursor = useTranslations("FX.common.cursor");
  const ref = useRef<HTMLPreElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const timer = useRef(0);
  const [copied, setCopied] = useState(false);
  const raw = (props as { "data-language"?: string })["data-language"] ?? "text";
  const language = LANGUAGE_LABELS[raw] ?? raw;
  const lines = countLines(children);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(ref.current?.textContent ?? "");
    } catch {
      // Clipboard may be unavailable (insecure context) — fail silently.
      return;
    }
    setCopied(true);
    burst(button.current, { count: 8, radius: 26 });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="pfx-code">
      <div className="pfx-code-bar">
        <span className="pfx-code-lang">{language}</span>
        {lines > 0 && <span className="pfx-code-meta">{t("codeLines", { count: lines })}</span>}
        <button
          ref={button}
          type="button"
          onClick={copy}
          aria-label={t("copyCode")}
          data-done={copied ? "" : undefined}
          data-cursor-text={cursor("copy")}
          className="pfx-copy"
        >
          <span aria-hidden="true" className="pfx-morph-icon">
            <Copy />
            <svg viewBox="0 0 24 24">
              <path d="M4.5 12.8l4.6 4.4L19.5 6.8" pathLength={1} />
            </svg>
          </span>
          <span aria-hidden="true" className="pfx-copy-label">
            <span>{tc("copied")}</span>
          </span>
        </button>
        <span role="status" className="sr-only">
          {copied ? tc("copied") : ""}
        </span>
      </div>
      <pre ref={ref} {...props}>
        {children}
      </pre>
    </div>
  );
}
