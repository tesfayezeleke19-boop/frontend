/**
 * Shared formatting helpers used across the Sales pages, so the same numbers
 * render identically everywhere (ETB currency, m³ quantities, human dates).
 */

export function formatCurrency(amount: unknown): string {
  const num = typeof amount === "number" && Number.isFinite(amount) ? amount : 0;
  return `${new Intl.NumberFormat("en-US").format(num)} ETB`;
}

export function formatQuantity(quantity: number, unit = "m³"): string {
  return `${new Intl.NumberFormat("en-US").format(quantity)} ${unit}`;
}

function parseDateValue(value: number | string | Date): Date {
  if (value instanceof Date) {
    return value;
  }

  if (typeof value === "number") {
    return new Date(value);
  }

  // Parse YYYY-MM-DD as a local date to avoid UTC date shifts.
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

  if (match) {
    return new Date(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      12,
    );
  }

  return new Date(value);
}

export function formatDate(
  timestamp: number | string | Date,
  options: { time?: boolean } = {},
): string {
  const date = parseDateValue(timestamp);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  const parts = new Intl.DateTimeFormat(
    "en-ET-u-ca-ethiopic-nu-latn",
    {
      day: "numeric",
      month: "long",
      year: "numeric",
      ...(options.time
        ? {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          }
        : {}),
    },
  ).formatToParts(date);

  const values = Object.fromEntries(
    parts
      .filter(
        (part) => part.type !== "era" && part.type !== "literal",
      )
      .map((part) => [part.type, part.value]),
  );

  const formatted = `${values.month} ${values.day}, ${values.year}`;

  return options.time && values.hour
    ? `${formatted}, ${values.hour}:${values.minute}`
    : formatted;
}
