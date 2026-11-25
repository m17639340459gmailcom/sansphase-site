"use client";

import { ChevronDown, Send } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { usePrefersReducedMotion } from "@/components/fx/hooks";
import { TerminalPath } from "@/components/fx/terminal-path";
import { TextRoll } from "@/components/fx/text-roll";
import { Button, buttonClasses } from "@/components/ui/button";
import { contactTopics } from "@/lib/contact-schema";
import { cn } from "@/lib/utils";
import { burst } from "./burst";
import styles from "./contact.module.css";

type Status =
  | { state: "idle" }
  | { state: "submitting" }
  | { state: "success"; delivered: boolean; name: string }
  | { state: "error"; kind: "rate_limited" | "generic" };

type Field = "name" | "email" | "message";
type FieldErrors = Partial<Record<Field, string>>;
type Phase = "idle" | "loading" | "success";

// Mirrors the server schema (lib/contact-schema).
const MIN_MESSAGE = 20;
const MAX_MESSAGE = 5000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ease = [0.16, 1, 0.3, 1] as const;
const invalid = "aria-[invalid=true]:border-red-500";

/** Stable ref callback: moves focus to the success heading once, when it mounts. */
const focusOnMount = (element: HTMLElement | null) => element?.focus({ preventScroll: true });

function isValid(field: Field, value: string) {
  if (field === "email") return EMAIL.test(value);
  if (field === "message") return value.trim().length >= MIN_MESSAGE;
  return value.trim().length > 0;
}

/** Horizontal shake for invalid fields (skipped for reduced motion). */
function shake(elements: (Element | null)[]) {
  for (const element of elements) {
    element?.animate(
      [{ translate: "0" }, { translate: "-7px" }, { translate: "6px" }, { translate: "-4px" }, { translate: "2px" }, { translate: "0" }],
      { duration: 420, easing: "ease-out" },
    );
  }
}

export function ContactForm() {
  const t = useTranslations("Contact.form");
  const fx = useTranslations("FX.contact.form");
  const locale = useLocale();
  const reduced = usePrefersReducedMotion();
  const [status, setStatus] = useState<Status>({ state: "idle" });
  const [revealed, setRevealed] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const submit = useRef<HTMLButtonElement>(null);
  const idleWidth = useRef(0);
  const lastPhase = useRef<Phase>("idle");

  const phase: Phase = status.state === "submitting" ? "loading" : status.state === "success" ? "success" : "idle";
  // The success panel waits for the check to draw and the burst to fire.
  const showSuccess = status.state === "success" && (reduced || revealed);

  // Morph the button: pill → circle while sending, and back when it fails.
  useLayoutEffect(() => {
    const button = submit.current;
    const from = lastPhase.current;
    lastPhase.current = phase;
    if (!button || reduced || from === phase) return;
    const height = button.offsetHeight;
    if (from === "idle") {
      const width = idleWidth.current || button.offsetWidth;
      button.animate([{ width: `${width}px` }, { width: `${height}px` }], {
        duration: 460,
        easing: "cubic-bezier(0.76, 0, 0.24, 1)",
        fill: "forwards",
      });
    } else if (phase === "idle") {
      button.getAnimations().forEach((animation) => animation.cancel());
      const width = button.offsetWidth;
      button.animate([{ width: `${height}px` }, { width: `${width}px` }], { duration: 560, easing: "cubic-bezier(0.16, 1, 0.3, 1)" });
    }
  }, [phase, reduced]);

  useEffect(() => {
    if (status.state !== "success" || reduced) return;
    const button = submit.current;
    const fire = window.setTimeout(() => button && burst(button), 360);
    const reveal = window.setTimeout(() => setRevealed(true), 1100);
    return () => {
      window.clearTimeout(fire);
      window.clearTimeout(reveal);
    };
  }, [status.state, reduced]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (phase !== "idle") return;
    const form = e.currentTarget;
    const fd = new FormData(form);
    const payload = {
      name: String(fd.get("name") ?? ""),
      email: String(fd.get("email") ?? ""),
      company: String(fd.get("company") ?? ""),
      topic: String(fd.get("topic") ?? "other"),
      message: String(fd.get("message") ?? ""),
      website: String(fd.get("website") ?? ""),
      locale,
    };

    // Client-side validation mirrors the server schema for instant feedback.
    const next: FieldErrors = {};
    if (!isValid("name", payload.name)) next.name = t("validation.name");
    if (!isValid("email", payload.email)) next.email = t("validation.email");
    if (!isValid("message", payload.message)) next.message = t("validation.message");
    setErrors(next);
    const failed = Object.keys(next) as Field[];
    if (failed.length > 0) {
      if (!reduced) shake(failed.map((field) => form.querySelector(`[data-field="${field}"]`)));
      form.querySelector<HTMLElement>(`[name="${failed[0]}"]`)?.focus();
      return;
    }

    idleWidth.current = submit.current?.offsetWidth ?? 0;
    setStatus({ state: "submitting" });
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.status === 429) {
        setStatus({ state: "error", kind: "rate_limited" });
        return;
      }
      const json = (await res.json()) as { ok: boolean; delivered?: boolean };
      if (!res.ok || !json.ok) throw new Error("failed");
      setStatus({ state: "success", delivered: Boolean(json.delivered), name: payload.name.trim() });
      form.reset();
    } catch {
      setStatus({ state: "error", kind: "generic" });
    }
  }

  // Once a field has been flagged, clear its error as soon as it becomes valid.
  function onInput(e: FormEvent<HTMLFormElement>) {
    const target = e.target as HTMLInputElement;
    const field = target.name as Field;
    if (!errors[field] || !isValid(field, target.value)) return;
    setErrors((prev) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }

  const statusLabel =
    status.state === "error" ? fx("failed") : phase === "loading" ? fx("sending") : phase === "success" ? fx("sent") : fx("ready");

  return (
    <div className="relative">
      <div className="mb-7 flex items-center justify-between gap-4 border-b border-line pb-4">
        <TerminalPath className="min-w-0 truncate" />
        <span
          role="status"
          data-phase={status.state === "error" ? "error" : phase}
          className={cn(styles.status, "shrink-0", status.state === "error" && "text-red-600 dark:text-red-400")}
        >
          {statusLabel}
        </span>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        {showSuccess && status.state === "success" ? (
          <motion.div
            key="success"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.6, ease }}
            className="flex min-h-80 flex-col items-start justify-center gap-5 py-4"
          >
            <span className="grid h-12 w-12 place-items-center rounded-xl bg-accent-soft text-accent">
              <svg aria-hidden viewBox="0 0 24 24" className={cn(styles.check, "h-6 w-6")}>
                <path d="M5 12.5l4.2 4.2L19 7" pathLength={1} />
              </svg>
            </span>
            <h3
              ref={focusOnMount}
              tabIndex={-1}
              className="font-display text-2xl font-semibold tracking-tight outline-none"
            >
              {t("successTitle")}
            </h3>
            <p className="text-muted">
              {status.delivered
                ? t("successBody", { name: status.name })
                : t("successBodyNoDelivery", { name: status.name })}
            </p>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setRevealed(false);
                setStatus({ state: "idle" });
              }}
            >
              {t("sendAnother")}
            </Button>
          </motion.div>
        ) : (
          <motion.form
            key="form"
            onSubmit={onSubmit}
            onInput={onInput}
            noValidate
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12, transition: { duration: 0.3, ease } }}
            transition={{ duration: 0.5, ease }}
            className="grid gap-5"
          >
            <div className="grid gap-5 sm:grid-cols-2">
              <FieldShell field="name" label={t("name")} error={errors.name}>
                <input
                  id="name"
                  name="name"
                  autoComplete="name"
                  maxLength={120}
                  placeholder={t("namePlaceholder")}
                  aria-invalid={!!errors.name}
                  aria-describedby={errors.name ? "name-error" : undefined}
                  className={cn(styles.input, invalid)}
                />
              </FieldShell>
              <FieldShell field="email" label={t("email")} error={errors.email}>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  maxLength={200}
                  placeholder={t("emailPlaceholder")}
                  aria-invalid={!!errors.email}
                  aria-describedby={errors.email ? "email-error" : undefined}
                  className={cn(styles.input, invalid)}
                />
              </FieldShell>
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <FieldShell field="company" label={t("company")}>
                <input
                  id="company"
                  name="company"
                  autoComplete="organization"
                  maxLength={160}
                  placeholder={t("companyPlaceholder")}
                  className={styles.input}
                />
              </FieldShell>
              <FieldShell
                field="topic"
                label={t("topic")}
                adornment={<ChevronDown aria-hidden className="pointer-events-none absolute top-1/2 right-3.5 h-4 w-4 -translate-y-1/2 text-muted" />}
              >
                <select id="topic" name="topic" defaultValue="fde" className={styles.input}>
                  {contactTopics.map((topic) => (
                    <option key={topic} value={topic}>
                      {t(`topics.${topic}`)}
                    </option>
                  ))}
                </select>
              </FieldShell>
            </div>

            <FieldShell field="message" label={t("message")} error={errors.message} adornment={<CharCounter />}>
              <textarea
                id="message"
                name="message"
                rows={6}
                maxLength={MAX_MESSAGE}
                placeholder={t("messagePlaceholder")}
                aria-invalid={!!errors.message}
                aria-describedby={errors.message ? "message-error" : undefined}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) event.currentTarget.form?.requestSubmit();
                }}
                className={cn(styles.input, invalid)}
              />
            </FieldShell>

            {/* Honeypot */}
            <div className="absolute -left-[9999px] top-0 h-0 w-0 overflow-hidden" aria-hidden>
              <label htmlFor="website">Website</label>
              <input id="website" name="website" tabIndex={-1} autoComplete="off" />
            </div>

            <AnimatePresence initial={false}>
              {status.state === "error" && (
                <motion.p
                  key={status.kind}
                  role="alert"
                  initial={{ opacity: 0, height: 0, y: -6 }}
                  animate={{ opacity: 1, height: "auto", y: 0 }}
                  exit={{ opacity: 0, height: 0, y: -6 }}
                  transition={{ duration: 0.4, ease }}
                  className="overflow-hidden"
                >
                  <span className="block rounded-[10px] border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">
                    <strong className="font-semibold">{t("errorTitle")}</strong>{" "}
                    {status.kind === "rate_limited" ? t("rateLimited") : t("errorBody")}
                  </span>
                </motion.p>
              )}
            </AnimatePresence>

            <div className="flex flex-col items-center gap-4 border-t border-line pt-5 sm:flex-row sm:justify-between">
              <div className="flex w-full justify-center sm:w-auto">
                <button
                  ref={submit}
                  type="submit"
                  aria-disabled={phase !== "idle"}
                  data-phase={phase}
                  className={cn(buttonClasses({ size: "lg" }), styles.submit, "w-full sm:w-auto")}
                >
                  <span aria-hidden className="fx-btn-fill" />
                  <span aria-hidden className="fx-btn-shine" />
                  {phase === "idle" && (
                    <>
                      <Send aria-hidden className="h-4 w-4 shrink-0" />
                      <TextRoll>{t("submit")}</TextRoll>
                    </>
                  )}
                  {phase === "loading" && (
                    <>
                      <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5 animate-spin">
                        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.3" strokeWidth="2.4" />
                        <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
                      </svg>
                      <span className="sr-only">{t("sending")}</span>
                    </>
                  )}
                  {phase === "success" && (
                    <>
                      <svg aria-hidden viewBox="0 0 24 24" className={cn(styles.check, "h-5 w-5")}>
                        <path d="M5 12.5l4.2 4.2L19 7" pathLength={1} />
                      </svg>
                      <span className="sr-only">{t("successTitle")}</span>
                    </>
                  )}
                </button>
              </div>
              <span className="hidden font-mono text-[10px] tracking-[0.14em] text-muted uppercase sm:inline">{fx("shortcut")}</span>
            </div>
          </motion.form>
        )}
      </AnimatePresence>
    </div>
  );
}

function FieldShell({
  field,
  label,
  error,
  adornment,
  children,
}: {
  field: string;
  label: string;
  error?: string;
  adornment?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col">
      <div className={styles.control} data-field={field}>
        {children}
        <label htmlFor={field} className={styles.label}>
          {label}
        </label>
        <span aria-hidden className={styles.ring} />
        {adornment}
      </div>
      <AnimatePresence initial={false}>
        {error && (
          <motion.p
            id={`${field}-error`}
            role="alert"
            initial={{ opacity: 0, height: 0, y: -4 }}
            animate={{ opacity: 1, height: "auto", y: 0 }}
            exit={{ opacity: 0, height: 0, y: -4 }}
            transition={{ duration: 0.35, ease }}
            className="overflow-hidden text-xs text-red-600 dark:text-red-400"
          >
            <span className="block pt-2">{error}</span>
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Live character count with a gauge that fills up to the minimum length (decorative). */
function CharCounter() {
  const ref = useRef<HTMLSpanElement>(null);
  const [count, setCount] = useState(0);

  useEffect(() => {
    const field = ref.current?.parentElement?.querySelector("textarea");
    const form = field?.form;
    if (!field) return;
    const update = () => setCount(field.value.length);
    const clear = () => setCount(0);
    field.addEventListener("input", update);
    form?.addEventListener("reset", clear);
    return () => {
      field.removeEventListener("input", update);
      form?.removeEventListener("reset", clear);
    };
  }, []);

  return (
    <span
      ref={ref}
      aria-hidden
      data-state={count >= MIN_MESSAGE ? "ok" : undefined}
      className={styles.counter}
      style={{ "--fill": Math.min(1, count / MIN_MESSAGE) } as CSSProperties}
    >
      <svg viewBox="0 0 16 16" className={cn(styles.gauge, "h-3.5 w-3.5")}>
        <circle cx="8" cy="8" r="6" />
        <circle cx="8" cy="8" r="6" pathLength={1} />
      </svg>
      {count}/{MAX_MESSAGE}
    </span>
  );
}
