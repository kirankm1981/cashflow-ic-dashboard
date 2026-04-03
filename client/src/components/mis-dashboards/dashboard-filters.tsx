import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Filter, X } from "lucide-react";
import { FilterState } from "./types";

interface DashboardFiltersProps {
  companies: string[];
  projects: string[];
  periods: string[];
  filters: FilterState;
  onChange: (filters: FilterState) => void;
}

export function DashboardFilters({ companies, projects, periods, filters, onChange }: DashboardFiltersProps) {
  const hasFilters = filters.companies.length > 0 || filters.projects.length > 0 || filters.period !== null;

  return (
    <div className="flex items-center gap-2 flex-wrap" data-testid="dashboard-filters">
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 text-xs" data-testid="filter-company">
            <Filter className="w-3 h-3 mr-1" />
            Company
            {filters.companies.length > 0 && (
              <Badge variant="secondary" className="ml-1 text-[10px] px-1 h-4">{filters.companies.length}</Badge>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 max-h-60 overflow-y-auto p-2">
          {companies.map(c => (
            <label key={c} className="flex items-center gap-2 py-1 px-2 hover:bg-muted rounded text-xs cursor-pointer">
              <Checkbox
                checked={filters.companies.includes(c)}
                onCheckedChange={(checked) => {
                  const next = checked
                    ? [...filters.companies, c]
                    : filters.companies.filter(x => x !== c);
                  onChange({ ...filters, companies: next });
                }}
              />
              <span className="truncate">{c}</span>
            </label>
          ))}
        </PopoverContent>
      </Popover>

      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 text-xs" data-testid="filter-project">
            <Filter className="w-3 h-3 mr-1" />
            Project
            {filters.projects.length > 0 && (
              <Badge variant="secondary" className="ml-1 text-[10px] px-1 h-4">{filters.projects.length}</Badge>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 max-h-60 overflow-y-auto p-2">
          {projects.map(p => (
            <label key={p} className="flex items-center gap-2 py-1 px-2 hover:bg-muted rounded text-xs cursor-pointer">
              <Checkbox
                checked={filters.projects.includes(p)}
                onCheckedChange={(checked) => {
                  const next = checked
                    ? [...filters.projects, p]
                    : filters.projects.filter(x => x !== p);
                  onChange({ ...filters, projects: next });
                }}
              />
              <span className="truncate">{p}</span>
            </label>
          ))}
        </PopoverContent>
      </Popover>

      <Select
        value={filters.period || "__all__"}
        onValueChange={(v) => onChange({ ...filters, period: v === "__all__" ? null : v })}
      >
        <SelectTrigger className="h-8 w-48 text-xs" data-testid="filter-period">
          <SelectValue placeholder="All Periods" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">All Periods</SelectItem>
          {periods.map(p => (
            <SelectItem key={p} value={p}>{p}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {hasFilters && (
        <Button
          variant="ghost"
          size="sm"
          className="h-8 text-xs"
          onClick={() => onChange({ companies: [], projects: [], period: null })}
          data-testid="filter-clear"
        >
          <X className="w-3 h-3 mr-1" />
          Clear
        </Button>
      )}
    </div>
  );
}
