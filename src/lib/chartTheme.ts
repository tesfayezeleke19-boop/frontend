/**
 * Chart theming — every Recharts colour comes from the CSS design tokens so
 * charts switch with the light/dark theme instead of hard-coding a palette.
 */
export const CHART_SERIES = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--violet)",
];

export const CHART_SERIES_8 = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--violet)",
  "var(--success)",
  "var(--info)",
];

export const CHART_GRID = "var(--border)";
export const CHART_AXIS = "var(--input)";
export const CHART_TICK_FILL = "var(--muted-foreground)";
export const CHART_PIE_STROKE = "var(--card)";
export const CHART_HOVER = "var(--row-hover)";

export const CHART_TOOLTIP_STYLE = {
  backgroundColor: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  fontSize: 12,
  color: "var(--popover-foreground)",
};

export const CHART_TOOLTIP_LABEL_STYLE = {
  color: "var(--popover-foreground)",
};
