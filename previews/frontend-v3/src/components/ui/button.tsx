import { ArrowUpRight } from "lucide-react";
import type { ComponentProps, MouseEventHandler, ReactNode } from "react";
import { TextRoll } from "@/components/fx/text-roll";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost";
type Size = "sm" | "md" | "lg";

const base =
  "fx-btn fx-roll-host group/btn relative isolate inline-flex shrink-0 items-center justify-center gap-3 overflow-hidden rounded-full font-medium tracking-tight transition-[transform,background-color,color,border-color,box-shadow] duration-200 ease-out active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50";

const variants: Record<Variant, string> = {
  primary: "fx-btn-primary bg-accent text-white dark:text-bg",
  secondary: "fx-btn-secondary border border-line-strong bg-transparent text-fg hover:border-accent",
  ghost: "fx-btn-ghost text-fg hover:text-accent",
};

const sizes: Record<Size, string> = {
  sm: "h-10 px-4 text-sm",
  md: "h-11 px-5 text-[15px]",
  lg: "h-12 px-6 text-[15px] sm:h-13 sm:px-7",
};

type StyleProps = {
  variant?: Variant;
  size?: Size;
  arrow?: boolean;
  className?: string;
};

export function buttonClasses({ variant = "primary", size = "md", className }: StyleProps) {
  return cn(base, variants[variant], sizes[size], className);
}

function Arrow() {
  return (
    <span className="relative inline-grid h-4 w-4 place-items-center overflow-hidden" data-magnetic-inner="">
      <ArrowUpRight className="absolute h-4 w-4 transition-transform duration-300 group-hover/btn:translate-x-4 group-hover/btn:-translate-y-4 group-focus-visible/btn:translate-x-4 group-focus-visible/btn:-translate-y-4" />
      <ArrowUpRight className="absolute h-4 w-4 -translate-x-4 translate-y-4 transition-transform duration-300 [color:var(--fx-roll-to,currentColor)] group-hover/btn:translate-x-0 group-hover/btn:translate-y-0 group-focus-visible/btn:translate-x-0 group-focus-visible/btn:translate-y-0" />
    </span>
  );
}

/** Fill layers behind the label: liquid blob + shine (primary), rising disc (secondary). */
function Fill({ variant = "primary" }: { variant?: Variant }) {
  if (variant === "ghost") return null;
  return (
    <>
      <span aria-hidden="true" className="fx-btn-fill" />
      {variant === "primary" && <span aria-hidden="true" className="fx-btn-shine" />}
    </>
  );
}

function Content({ children, arrow, variant }: { children: ReactNode; arrow?: boolean; variant?: Variant }) {
  return (
    <>
      <Fill variant={variant} />
      <TextRoll>{children}</TextRoll>
      {arrow && <Arrow />}
    </>
  );
}

type ButtonLinkProps = StyleProps & {
  href: string;
  children: ReactNode;
  "data-cursor-text"?: string;
  onClick?: MouseEventHandler<HTMLAnchorElement>;
  onNavigate?: ComponentProps<typeof Link>["onNavigate"];
  scroll?: boolean;
};

/**
 * Internal links go through next-intl's locale-aware Link; external ones open in a new tab.
 * Hover (fine pointers) and keyboard focus roll the label and fill the button; override the fill
 * with `[--btn-fill:…]` and the incoming label color with `[--fx-roll-to:…]` when restyling.
 */
export function ButtonLink({ href, children, arrow, onClick, onNavigate, scroll, "data-cursor-text": cursorText, ...style }: ButtonLinkProps) {
  const classes = buttonClasses(style);
  const content = (
    <Content arrow={arrow} variant={style.variant}>
      {children}
    </Content>
  );
  const isExternal = href.startsWith("http") || href.startsWith("mailto:");
  if (isExternal) {
    return (
      <a
        href={href}
        onClick={onClick}
        className={classes}
        data-cursor-text={cursorText}
        target={href.startsWith("http") ? "_blank" : undefined}
        rel={href.startsWith("http") ? "noreferrer noopener" : undefined}
      >
        {content}
      </a>
    );
  }
  return (
    <Link href={href} className={classes} onClick={onClick} onNavigate={onNavigate} scroll={scroll} data-cursor-text={cursorText}>
      {content}
    </Link>
  );
}

type ButtonProps = StyleProps &
  Omit<ComponentProps<"button">, "className"> & { children: ReactNode };

export function Button({ children, arrow, variant, size, className, ...rest }: ButtonProps) {
  return (
    <button className={buttonClasses({ variant, size, className })} {...rest}>
      <Content arrow={arrow} variant={variant}>
        {children}
      </Content>
    </button>
  );
}
