import { Odometer } from "@/components/fx/odometer";

/** Rolls into place when scrolled into view (see fx/Odometer). Non-digits stay static. */
export function Counter({ value, className }: { value: string; className?: string }) {
  return <Odometer value={value} className={className} />;
}
