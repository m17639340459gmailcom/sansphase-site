import { getBrandIcon } from "@/lib/icons";
import { cn } from "@/lib/utils";

/**
 * Renders a brand glyph from simple-icons, or a monogram tile when the brand
 * isn't available. `mono` renders in currentColor (default) — `brand` uses the
 * official hex.
 */
export function TechIcon({
  icon,
  name,
  size = 20,
  brand = false,
  className,
}: {
  icon?: string;
  name: string;
  size?: number;
  brand?: boolean;
  className?: string;
}) {
  const data = getBrandIcon(icon);
  if (!data) {
    const initials = name
      .replace(/[^A-Za-z0-9\u4e00-\u9fff ]/g, " ")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join("");
    return (
      <span
        aria-hidden
        style={{ width: size, height: size, fontSize: Math.max(8, size * 0.42) }}
        className={cn(
          "inline-grid shrink-0 place-items-center rounded-[28%] border border-line bg-accent-soft font-mono font-semibold leading-none text-accent",
          className,
        )}
      >
        {initials || "•"}
      </span>
    );
  }
  return (
    <svg
      role="img"
      aria-label={data.title}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={cn("shrink-0", className)}
      fill={brand ? `#${data.hex}` : "currentColor"}
    >
      <path d={data.path} />
    </svg>
  );
}
