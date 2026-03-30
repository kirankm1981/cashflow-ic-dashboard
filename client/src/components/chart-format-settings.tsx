import { Settings2 } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useDashboardSettings } from "@/hooks/use-dashboard-settings";
import type { NumberScale } from "@/lib/number-format";
import { SCALE_LABELS } from "@/lib/number-format";

interface ChartFormatSettingsProps {
  chartId: string;
  className?: string;
}

export function ChartFormatSettings({ chartId, className = "" }: ChartFormatSettingsProps) {
  const { getFormat, updateSetting } = useDashboardSettings();
  const current = getFormat(chartId);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={`h-7 w-7 text-muted-foreground hover:text-foreground ${className}`}
          data-testid={`btn-chart-settings-${chartId}`}
        >
          <Settings2 className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56" align="end">
        <div className="space-y-3">
          <p className="text-sm font-medium">Number Format</p>
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Scale</Label>
            <Select
              value={current.scale}
              onValueChange={(val) =>
                updateSetting({
                  chartId,
                  numberScale: val as NumberScale,
                  decimalPlaces: current.decimals,
                })
              }
            >
              <SelectTrigger className="h-8 text-xs" data-testid={`select-scale-${chartId}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(SCALE_LABELS) as NumberScale[]).map((scale) => (
                  <SelectItem key={scale} value={scale}>
                    {SCALE_LABELS[scale]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Decimal Places</Label>
            <Select
              value={String(current.decimals)}
              onValueChange={(val) =>
                updateSetting({
                  chartId,
                  numberScale: current.scale,
                  decimalPlaces: parseInt(val),
                })
              }
            >
              <SelectTrigger className="h-8 text-xs" data-testid={`select-decimals-${chartId}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">0</SelectItem>
                <SelectItem value="1">1</SelectItem>
                <SelectItem value="2">2</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
