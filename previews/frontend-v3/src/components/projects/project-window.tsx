import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import styles from "./project-window.module.css";

/**
 * Browser-window frame around a real screenshot. Shared by cards, the index preview, the case
 * hero and the next-project link so a cover morphs between identical frames across routes.
 */
export function ProjectWindow({
  label,
  action,
  children,
  className,
}: {
  label: ReactNode;
  /** Interactive control at the end of the title bar; a decorative spacer otherwise. */
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn(styles.window, className)}>
      <div className={styles.bar}>
        <span aria-hidden="true" className={styles.dots}>
          <i />
          <i />
          <i />
        </span>
        <span aria-hidden="true" className={styles.label}>
          {label}
        </span>
        {action ?? <span aria-hidden="true" className={styles.spacer} />}
      </div>
      {children}
    </div>
  );
}
