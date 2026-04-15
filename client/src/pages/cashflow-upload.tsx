import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useUploadManager } from "@/lib/upload-manager";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmDestructiveDialog } from "@/components/confirm-destructive-dialog";
import {
  Upload,
  FileSpreadsheet,
  Trash2,
  Loader2,
  Plus,
  X,
  RefreshCw,
  Database,
  AlertCircle,
  CheckCircle,
  Download,
  Ban,
  Clock,
} from "lucide-react";
function formatNum(val: number | null | undefined): string {
  if (val === null || val === undefined) return "0";
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(val);
}

interface TbUploadSlot {
  id: string;
  label: string;
  file: File | null;
}

export default function CashflowUpload() {
  const { toast } = useToast();
  const { uploadCashflowTb, uploadCashflowMapping, notifications } = useUploadManager();
  const cashflowNotifications = notifications.filter(n => n.module === "cashflow");
  const [uploadingSlots, setUploadingSlots] = useState<Set<string>>(new Set());
  const [mappingUploading, setMappingUploading] = useState(false);
  const mappingInputRef = useRef<HTMLInputElement>(null);
  const [tbSlots, setTbSlots] = useState<TbUploadSlot[]>([
    { id: "1", label: "TB 1", file: null },
    { id: "2", label: "TB 2", file: null },
  ]);

  const { data: summary } = useQuery<any>({
    queryKey: ["/api/cashflow/summary"],
  });

  const { data: mappingSummary } = useQuery<any>({
    queryKey: ["/api/cashflow/mapping-summary"],
  });

  const hasActiveTbFiles = (files?: any[]) => files?.some((f: any) => ["parsing", "inserting"].includes(f.status));

  const { data: tbFiles } = useQuery<any[]>({
    queryKey: ["/api/cashflow/tb-files"],
    refetchInterval: (query) => {
      const data = query.state.data as any[] | undefined;
      if (hasActiveTbFiles(data)) return 2000;
      return 30000;
    },
  });

  const prevActiveTbRef = useRef(0);
  useEffect(() => {
    const currentActive = tbFiles?.filter((f: any) => ["parsing", "inserting"].includes(f.status)).length || 0;
    if (prevActiveTbRef.current > 0 && currentActive === 0 && tbFiles && tbFiles.length > 0) {
      queryClient.invalidateQueries({ queryKey: ["/api/cashflow/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cashflow/compiled-data"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cashflow/unified-data"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cashflow/unmapped-items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cashflow/dashboard-data"] });
    }
    prevActiveTbRef.current = currentActive;
  }, [tbFiles]);

  const { data: exclusionData } = useQuery<{ excluded: Array<{ id: number; company: string; reason: string }>; availableCompanies: string[] }>({
    queryKey: ["/api/cashflow/excluded-entities"],
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/cashflow/excluded-entities"] });
    queryClient.invalidateQueries({ queryKey: ["/api/cashflow/mapping-summary"] });
    queryClient.invalidateQueries({ queryKey: ["/api/cashflow/summary"] });
    queryClient.invalidateQueries({ queryKey: ["/api/cashflow/compiled-data"] });
    queryClient.invalidateQueries({ queryKey: ["/api/cashflow/unified-data"] });
    queryClient.invalidateQueries({ queryKey: ["/api/cashflow/unmapped-items"] });
    queryClient.invalidateQueries({ queryKey: ["/api/cashflow/dashboard-data"] });
  };

  const wrappedTbUpload = async (slot: TbUploadSlot) => {
    if (!slot.file) return;
    setUploadingSlots(prev => new Set(prev).add(slot.id));
    try {
      await uploadCashflowTb(slot.file, slot.label, slot.id);
    } finally {
      setUploadingSlots(prev => { const s = new Set(prev); s.delete(slot.id); return s; });
    }
  };

  const wrappedMappingUpload = async () => {
    const file = mappingInputRef.current?.files?.[0];
    if (!file) return;
    setMappingUploading(true);
    try {
      await uploadCashflowMapping(file);
    } finally {
      setMappingUploading(false);
    }
  };

  const reprocessMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/cashflow/reprocess", { method: "POST", credentials: "include" });
      if (!res.ok) throw new Error("Reprocess failed");
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Reprocessed", description: `${formatNum(data.updated)} records updated with latest mappings` });
      queryClient.invalidateQueries({ queryKey: ["/api/cashflow/compiled-data"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cashflow/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cashflow/unified-data"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cashflow/unmapped-items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cashflow/past-losses"] });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteTbMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/cashflow/tb-file/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        throw new Error(errBody || `Delete failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Deleted", description: "TB file removed" });
      queryClient.invalidateQueries({ queryKey: ["/api/cashflow/tb-files"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cashflow/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cashflow/compiled-data"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cashflow/unified-data"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cashflow/unmapped-items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cashflow/past-losses"] });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const clearTbMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/cashflow/clear-tb", { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("Clear failed");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Cleared", description: "All TB data removed" });
      queryClient.invalidateQueries({ queryKey: ["/api/cashflow/tb-files"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cashflow/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cashflow/compiled-data"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cashflow/unified-data"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cashflow/unmapped-items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cashflow/past-losses"] });
    },
  });

  const clearMappingMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/cashflow/clear-mapping", { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("Clear failed");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Cleared", description: "Mapping data removed" });
      queryClient.invalidateQueries({ queryKey: ["/api/cashflow/mapping-summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cashflow/past-losses"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cashflow/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cashflow/compiled-data"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cashflow/unified-data"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cashflow/unmapped-items"] });
    },
  });

  const addTbSlot = () => {
    const nextId = String(tbSlots.length + 1);
    setTbSlots(prev => [...prev, { id: nextId, label: `TB ${nextId}`, file: null }]);
  };

  const removeTbSlot = (id: string) => {
    if (tbSlots.length <= 1) return;
    setTbSlots(prev => prev.filter(s => s.id !== id));
  };

  const updateSlotFile = (id: string, file: File | null) => {
    setTbSlots(prev => prev.map(s => s.id === id ? { ...s, file } : s));
  };

  return (
    <div className="p-6 space-y-6" data-testid="page-cashflow-upload">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-cashflow-upload-title">
            MIS Upload
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Upload Trial Balance files and MIS mapping to compile data
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">TB Files</p>
            <p className="text-2xl font-bold mt-1" data-testid="text-cf-tb-count">{summary?.tbFiles || 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Records</p>
            <p className="text-2xl font-bold mt-1" data-testid="text-cf-records">{formatNum(summary?.compiledRecords)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Grouping Mappings</p>
            <p className="text-2xl font-bold mt-1" data-testid="text-cf-groupings">{formatNum(mappingSummary?.groupings)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Entity Mappings</p>
            <p className="text-2xl font-bold mt-1" data-testid="text-cf-entities">{formatNum(mappingSummary?.entities)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Excluded Entities</p>
            <p className="text-2xl font-bold mt-1 text-amber-600" data-testid="text-cf-excluded">{exclusionData?.excluded?.length || 0}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <FileSpreadsheet className="w-4 h-4" />
                Trial Balance Files
              </CardTitle>
              <div className="flex gap-2">
                {(tbFiles?.length ?? 0) > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => window.open("/api/cashflow/download-mapped-tb", "_blank")}
                    data-testid="button-download-mapped"
                  >
                    <Download className="w-3 h-3 mr-1" /> Download Mapped TB
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={addTbSlot} data-testid="button-add-tb-slot">
                  <Plus className="w-3 h-3 mr-1" /> Add
                </Button>
                {(tbFiles?.length ?? 0) > 0 && (
                  <ConfirmDestructiveDialog
                    trigger={
                      <Button variant="outline" size="sm" data-testid="button-clear-tb">
                        <Trash2 className="w-3 h-3 mr-1" /> Clear All
                      </Button>
                    }
                    title="Clear All TB Data"
                    description="This will remove all uploaded Trial Balance files and compiled data. This action cannot be undone."
                    confirmWord="DELETE"
                    onConfirm={() => clearTbMutation.mutate()}
                    isPending={clearTbMutation.isPending}
                  />
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {tbSlots.map((slot) => (
              <div key={slot.id} className="border rounded-lg p-3 space-y-2" data-testid={`slot-tb-${slot.id}`}>
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">{slot.label}</Label>
                  {tbSlots.length > 1 && (
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => removeTbSlot(slot.id)}>
                      <X className="w-3 h-3" />
                    </Button>
                  )}
                </div>
                <div className="flex gap-2">
                  <Input
                    type="file"
                    accept=".xlsx,.xls"
                    className="flex-1 text-xs"
                    onChange={(e) => updateSlotFile(slot.id, e.target.files?.[0] || null)}
                    data-testid={`input-tb-file-${slot.id}`}
                  />
                  <Button
                    size="sm"
                    disabled={!slot.file || uploadingSlots.has(slot.id)}
                    onClick={() => wrappedTbUpload(slot)}
                    data-testid={`button-upload-tb-${slot.id}`}
                  >
                    {uploadingSlots.has(slot.id) ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3 mr-1" />}
                    Upload
                  </Button>
                </div>
              </div>
            ))}

            {tbFiles && tbFiles.length > 0 && (
              <div className="mt-4 space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Uploaded Files</p>
                {tbFiles.map((f: any) => {
                  const isActive = ["parsing", "inserting"].includes(f.status);
                  const isError = f.status === "error";
                  return (
                  <div key={f.id} className={`flex items-center justify-between border rounded p-2 ${isError ? "border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-950/20" : ""}`} data-testid={`uploaded-tb-${f.id}`}>
                    <div className="flex items-center gap-2 min-w-0">
                      {isActive ? (
                        <Loader2 className="w-3.5 h-3.5 text-blue-500 animate-spin shrink-0" />
                      ) : isError ? (
                        <AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                      ) : (
                        <CheckCircle className="w-3.5 h-3.5 text-green-500 shrink-0" />
                      )}
                      <div className="min-w-0">
                        <p className="text-xs font-medium truncate">{f.enterprise || f.label}</p>
                        <div className="text-[10px] text-muted-foreground">
                          {f.fileName}
                          {f.totalRecords > 0 && <span> — {formatNum(f.totalRecords)} records</span>}
                          {f.period && <span> · {f.period}</span>}
                          {isActive && <Badge variant="outline" className="ml-1 text-[9px] px-1 py-0 text-blue-600 border-blue-300 dark:text-blue-400 dark:border-blue-600">{f.status === "parsing" ? "Parsing" : "Saving"}</Badge>}
                          {isError && <Badge variant="outline" className="ml-1 text-[9px] px-1 py-0 text-red-600 border-red-300">Error</Badge>}
                        </div>
                        {f.statusMessage && isActive && (
                          <p className="text-[10px] text-blue-600 dark:text-blue-400">{f.statusMessage}</p>
                        )}
                        {f.statusMessage && isError && (
                          <p className="text-[10px] text-red-600 dark:text-red-400">{f.statusMessage}</p>
                        )}
                      </div>
                    </div>
                    <ConfirmDestructiveDialog
                      trigger={
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                          disabled={isActive}
                          data-testid={`button-delete-tb-${f.id}`}
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      }
                      title={`Delete "${f.originalName}"?`}
                      description="This will permanently remove this file and all its TB data."
                      confirmWord="DELETE"
                      onConfirm={() => deleteTbMutation.mutate(f.id)}
                      isPending={deleteTbMutation.isPending}
                    />
                  </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Database className="w-4 h-4" />
                MIS Mapping File
              </CardTitle>
              {mappingSummary?.hasMapping && (
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => window.open("/api/cashflow/download-mapping", "_blank")}
                    data-testid="button-download-mapping-file"
                  >
                    <Download className="w-3 h-3 mr-1" />
                    Download
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => reprocessMutation.mutate()}
                    disabled={reprocessMutation.isPending}
                    data-testid="button-reprocess-cf"
                  >
                    {reprocessMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <RefreshCw className="w-3 h-3 mr-1" />}
                    Reprocess
                  </Button>
                  <ConfirmDestructiveDialog
                    trigger={
                      <Button variant="outline" size="sm" data-testid="button-clear-mapping">
                        <Trash2 className="w-3 h-3 mr-1" /> Clear
                      </Button>
                    }
                    title="Clear Mapping Data"
                    description="This will remove all cashflow groupings, entity mappings, and past losses data. This action cannot be undone."
                    confirmWord="DELETE"
                    onConfirm={() => clearMappingMutation.mutate()}
                    isPending={clearMappingMutation.isPending}
                  />
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="border rounded-lg p-3 space-y-2">
              <Label className="text-sm font-medium">Upload Mapping File</Label>
              <p className="text-xs text-muted-foreground">
                Excel file with sheets: "Groupings List", "Entity List", "Past Losses"
              </p>
              <div className="flex gap-2">
                <Input
                  ref={mappingInputRef}
                  type="file"
                  accept=".xlsx,.xls"
                  className="flex-1 text-xs"
                  data-testid="input-cf-mapping-file"
                />
                <Button
                  size="sm"
                  disabled={mappingUploading}
                  onClick={wrappedMappingUpload}
                  data-testid="button-upload-cf-mapping"
                >
                  {mappingUploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3 mr-1" />}
                  Upload
                </Button>
              </div>
            </div>

            {mappingSummary && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Mapping Status</p>
                <div className="grid grid-cols-1 gap-2">
                  <div className="flex items-center justify-between border rounded p-2">
                    <div className="flex items-center gap-2">
                      {mappingSummary.groupings > 0 ? (
                        <CheckCircle className="w-3.5 h-3.5 text-green-500" />
                      ) : (
                        <AlertCircle className="w-3.5 h-3.5 text-amber-500" />
                      )}
                      <span className="text-xs">Groupings (MIS / CF Head)</span>
                    </div>
                    <Badge variant={mappingSummary.groupings > 0 ? "default" : "secondary"} className="text-[10px]">
                      {formatNum(mappingSummary.groupings)} mappings
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between border rounded p-2">
                    <div className="flex items-center gap-2">
                      {mappingSummary.entities > 0 ? (
                        <CheckCircle className="w-3.5 h-3.5 text-green-500" />
                      ) : (
                        <AlertCircle className="w-3.5 h-3.5 text-amber-500" />
                      )}
                      <span className="text-xs">Entities (Structure / Project / Status)</span>
                    </div>
                    <Badge variant={mappingSummary.entities > 0 ? "default" : "secondary"} className="text-[10px]">
                      {formatNum(mappingSummary.entities)} entities
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between border rounded p-2">
                    <div className="flex items-center gap-2">
                      {mappingSummary.pastLosses > 0 ? (
                        <CheckCircle className="w-3.5 h-3.5 text-green-500" />
                      ) : (
                        <AlertCircle className="w-3.5 h-3.5 text-amber-500" />
                      )}
                      <span className="text-xs">Past Losses</span>
                    </div>
                    <Badge variant={mappingSummary.pastLosses > 0 ? "default" : "secondary"} className="text-[10px]">
                      {formatNum(mappingSummary.pastLosses)} records
                    </Badge>
                  </div>
                  {mappingSummary.excludedEntities > 0 && (
                    <div className="flex items-center justify-between border rounded p-2">
                      <div className="flex items-center gap-2">
                        <Ban className="w-3.5 h-3.5 text-amber-500" />
                        <span className="text-xs">Excluded from Cashflow</span>
                      </div>
                      <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-300">
                        {formatNum(mappingSummary.excludedEntities)} companies
                      </Badge>
                    </div>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Ban className="w-4 h-4" />
            Excluded Entities
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Companies listed here are excluded from all Cashflow reports and dashboards. This list is managed via the <strong>Unmapped_Entities</strong> sheet in the mapping file.
          </p>

          {(exclusionData?.excluded?.length ?? 0) > 0 ? (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Currently Excluded ({exclusionData!.excluded.length} compan{exclusionData!.excluded.length === 1 ? "y" : "ies"})
              </p>
              <div className="border rounded-lg divide-y max-h-64 overflow-y-auto">
                {exclusionData!.excluded.map(e => (
                  <div key={e.id} className="flex items-center px-3 py-2" data-testid={`excluded-entity-${e.id}`}>
                    <Ban className="w-3.5 h-3.5 text-amber-500 shrink-0 mr-2" />
                    <span className="text-xs truncate">{e.company}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground italic">No excluded entities. Upload a mapping file with an Unmapped_Entities sheet to populate this list.</p>
          )}
        </CardContent>
      </Card>

      {cashflowNotifications.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Upload Activity</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {cashflowNotifications.map(n => (
              <div key={n.id} className="flex items-center gap-3 text-xs">
                {n.status === "uploading" || n.status === "processing" ? (
                  <Loader2 className="w-3 h-3 animate-spin text-blue-500" />
                ) : n.status === "success" ? (
                  <CheckCircle className="w-3 h-3 text-green-500" />
                ) : (
                  <AlertCircle className="w-3 h-3 text-red-500" />
                )}
                <span className="font-medium">{n.label}</span>
                <span className="text-muted-foreground">{n.message}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

    </div>
  );
}
