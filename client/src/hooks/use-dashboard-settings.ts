import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { NumberScale, FormatConfig } from "@/lib/number-format";
import { DEFAULT_FORMAT, CHART_DEFAULTS } from "@/lib/number-format";

interface DashboardSetting {
  id: number;
  userId: string;
  chartId: string;
  numberScale: string;
  decimalPlaces: number;
}

export function useDashboardSettings() {
  const { data: settings = [], isLoading } = useQuery<DashboardSetting[]>({
    queryKey: ["/api/dashboard-settings"],
  });

  const updateMutation = useMutation({
    mutationFn: async ({
      chartId,
      numberScale,
      decimalPlaces,
    }: {
      chartId: string;
      numberScale: NumberScale;
      decimalPlaces: number;
    }) => {
      await apiRequest("PUT", `/api/dashboard-settings/${chartId}`, {
        numberScale,
        decimalPlaces,
      });
    },
    onMutate: async ({ chartId, numberScale, decimalPlaces }) => {
      await queryClient.cancelQueries({ queryKey: ["/api/dashboard-settings"] });
      const previous = queryClient.getQueryData<DashboardSetting[]>(["/api/dashboard-settings"]);
      queryClient.setQueryData<DashboardSetting[]>(["/api/dashboard-settings"], (old = []) => {
        const idx = old.findIndex((s) => s.chartId === chartId);
        if (idx >= 0) {
          const updated = [...old];
          updated[idx] = { ...updated[idx], numberScale, decimalPlaces };
          return updated;
        }
        return [...old, { id: 0, userId: "", chartId, numberScale, decimalPlaces }];
      });
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["/api/dashboard-settings"], context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard-settings"] });
    },
  });

  function getFormat(chartId: string): FormatConfig {
    const setting = settings.find((s) => s.chartId === chartId);
    if (!setting) return CHART_DEFAULTS[chartId] || DEFAULT_FORMAT;
    return {
      scale: setting.numberScale as NumberScale,
      decimals: setting.decimalPlaces,
    };
  }

  return {
    settings,
    isLoading,
    getFormat,
    updateSetting: updateMutation.mutate,
    isUpdating: updateMutation.isPending,
  };
}
