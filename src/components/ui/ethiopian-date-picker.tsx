import { useState } from "react";
import { DayPicker } from "react-day-picker/ethiopic";
import { CalendarDays } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface EthiopianDatePickerProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
}

function parseDate(value: string): Date | undefined {
  if (!value) return undefined;

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;

  const [, year, month, day] = match;
  const date = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    12,
  );

  // Reject invalid dates such as February 30.
  if (
    date.getFullYear() !== Number(year) ||
    date.getMonth() !== Number(month) - 1 ||
    date.getDate() !== Number(day)
  ) {
    return undefined;
  }

  return date;
}

function toDateValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function formatEthiopianDate(date: Date): string {
  const parts = new Intl.DateTimeFormat(
    "en-ET-u-ca-ethiopic-nu-latn",
    {
      day: "numeric",
      month: "long",
      year: "numeric",
    },
  ).formatToParts(date);

  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "era" && part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );

  return `${values.month} ${values.day}, ${values.year}`;
}

export function EthiopianDatePicker({
  value,
  onChange,
  className,
  placeholder = "Select Ethiopian date",
}: EthiopianDatePickerProps) {
  const [open, setOpen] = useState(false);
  const selected = parseDate(value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className={cn(
            "h-9 w-full justify-start gap-2 border-input bg-popover text-left text-sm font-normal text-foreground hover:bg-accent hover:text-foreground",
            !selected && "text-muted-foreground",
            className,
          )}
        >
          <CalendarDays className="size-4 shrink-0" />
          {selected ? formatEthiopianDate(selected) : placeholder}
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        className="w-auto border-input bg-popover p-2 text-foreground"
      >
        <DayPicker
          mode="single"
          selected={selected}
          onSelect={(date) => {
            if (!date) return;

            onChange(toDateValue(date));
            setOpen(false);
          }}
          numerals="latn"
          showOutsideDays
          className="p-2"
          classNames={{
            months: "flex flex-col",
            month: "space-y-3",
            month_caption: "flex justify-center pt-1 relative items-center",
            caption_label: "text-sm font-medium text-foreground",
            nav: "flex items-center gap-1",
            button_previous:
              "absolute left-1 inline-flex size-7 items-center justify-center rounded-md border border-input bg-transparent text-foreground hover:bg-accent",
            button_next:
              "absolute right-1 inline-flex size-7 items-center justify-center rounded-md border border-input bg-transparent text-foreground hover:bg-accent",
            month_grid: "w-full border-collapse",
            weekdays: "flex",
            weekday:
              "w-9 rounded-md text-[0.8rem] font-normal text-muted-foreground",
            week: "mt-2 flex w-full",
            day: "relative size-9 p-0 text-center text-sm",
            day_button:
              "inline-flex size-9 items-center justify-center rounded-md text-sm text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            selected:
              "[&>button]:bg-success [&>button]:text-primary-foreground [&>button]:font-semibold",
            today: "[&>button]:border [&>button]:border-success",
            outside: "text-muted-foreground/70 opacity-50",
            disabled: "text-muted-foreground/70 opacity-30",
            hidden: "invisible",
          }}
        />
      </PopoverContent>
    </Popover>
  );
}