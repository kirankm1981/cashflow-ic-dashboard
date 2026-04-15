import { useState, useRef, useEffect } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, X, Search } from "lucide-react";
import { cn } from "@/lib/utils";

interface Option {
  value: string;
  label: string;
}

interface MultiSelectFilterProps {
  options: Option[];
  selected: string[];
  onChange: (selected: string[]) => void;
  placeholder: string;
  className?: string;
  "data-testid"?: string;
}

export function MultiSelectFilter({
  options,
  selected,
  onChange,
  placeholder,
  className,
  "data-testid": testId,
}: MultiSelectFilterProps) {
  const [open, setOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
    if (!open) setSearchTerm("");
  }, [open]);

  const filtered = searchTerm
    ? options.filter(o => o.label.toLowerCase().includes(searchTerm.toLowerCase()))
    : options;

  const toggle = (value: string) => {
    if (selected.includes(value)) {
      onChange(selected.filter(v => v !== value));
    } else {
      onChange([...selected, value]);
    }
  };

  const selectAll = () => {
    onChange(filtered.map(o => o.value));
  };

  const clearAll = () => {
    onChange([]);
  };

  const selectedLabels = selected
    .map(v => options.find(o => o.value === v)?.label || v)
    .slice(0, 2);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("h-8 justify-between text-xs font-normal", className)}
          data-testid={testId}
        >
          <span className="truncate">
            {selected.length === 0
              ? placeholder
              : selected.length === 1
                ? selectedLabels[0]
                : `${selected.length} selected`}
          </span>
          <ChevronDown className="ml-1 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <div className="p-2 border-b">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              ref={inputRef}
              placeholder="Search..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="h-7 text-xs pl-7"
              data-testid={testId ? `${testId}-search` : undefined}
            />
          </div>
          <div className="flex gap-2 mt-1.5">
            <button
              onClick={selectAll}
              className="text-[10px] text-primary hover:underline"
              data-testid={testId ? `${testId}-select-all` : undefined}
            >
              Select All
            </button>
            <button
              onClick={clearAll}
              className="text-[10px] text-muted-foreground hover:underline"
              data-testid={testId ? `${testId}-clear-all` : undefined}
            >
              Clear All
            </button>
          </div>
        </div>
        <div className="max-h-48 overflow-auto p-1">
          {filtered.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-3">No options found</p>
          ) : (
            filtered.map((option) => (
              <label
                key={option.value}
                className="flex items-center gap-2 px-2 py-1 rounded text-xs cursor-pointer hover:bg-muted/50"
                data-testid={testId ? `${testId}-option-${option.value}` : undefined}
              >
                <Checkbox
                  checked={selected.includes(option.value)}
                  onCheckedChange={() => toggle(option.value)}
                  className="h-3.5 w-3.5"
                />
                <span className="truncate">{option.label}</span>
              </label>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
