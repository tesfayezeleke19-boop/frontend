
/**
 * HATI PLC brand mark.
 *
 * Displays the logo directly with its transparent background,
 * without adding a white tile, background, or border.
 */
import { cn } from "@/lib/utils";

interface BrandLogoProps {
  /** Rendered size in pixels (the emblem is square). */
  size?: number;
  className?: string;
  /** Hide from assistive tech when the surrounding text already names the brand. */
  decorative?: boolean;
}

export function BrandLogo({
  size = 32,
  className,
  decorative = true,
}: BrandLogoProps) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden",
        className,
      )}
      style={{ width: size, height: size }}
    >
      <img
        src="/brand/hati-logo.png"
        alt={decorative ? "" : "HATI PLC"}
        aria-hidden={decorative || undefined}
        width={size}
        height={size}
        className="size-full object-contain"
        draggable={false}
      />
    </span>
  );
}
