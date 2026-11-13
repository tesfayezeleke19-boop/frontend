/**
 * Accessible light/dark theme switch.
 *
 * The choice is persisted by next-themes (localStorage) and applied as the
 * `dark` class on <html>, which is set before first paint by the inline
 * script in index.html so the page never flashes the wrong theme.
 */
import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ThemeToggleProps {
  className?: string;
  /** `icon` for toolbars, `full` for settings/profile areas. */
  variant?: "icon" | "full";
}

export function ThemeToggle({ className, variant = "icon" }: ThemeToggleProps) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  // Before mount the resolved theme is unknown; assume the dark default so the
  // control never shows the wrong icon for a frame.
  const isDark = mounted ? resolvedTheme !== "light" : true;
  const next = isDark ? "light" : "dark";
  const label = `Switch to ${next} theme`;

  if (variant === "full") {
    return (
      <Button
        type="button"
        variant="outline"
        onClick={() => setTheme(next)}
        aria-label={label}
        className={cn("gap-2 border-input text-foreground", className)}
      >
        {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
        {isDark ? "Light theme" : "Dark theme"}
      </Button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      aria-label={label}
      title={label}
      aria-pressed={isDark}
      className={cn(
        "relative rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        className,
      )}
    >
      {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  );
}
