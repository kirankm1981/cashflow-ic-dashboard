import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useUploadManager } from "@/lib/upload-manager";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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
  const [clearTbDialogOpen, setClearTbDialogOpen] = useState(false);
  const [clearMappingDialogOpen, setClearMappingDialogOpen] = useState(false);
  const [uploadingSlots, setUploadingSlots] = useState<Set<string>>(new Set());
  const [mappingUploading, setMappingUploading] = useState(false);
  const mappingInputRef = useRef<HTMLInputElement>(null);
  const [tbSlots, setTbSlots] = useState<TbUploadSlot[]>([
    { id: "1", label: "TB 1", file: null },
    { id: "2", label: "TB 2", file: null },
    { id: "3", label: "TB 3", file: null },
  ]);

  const { data: summary } = useQuery<any>({
    queryKey: ["/api/cashflow/summary"],
  });

  const { data: mappingSummary } = useQuery<any>({
    queryKey: ["/api/cashflow/mapping-summary"],
  });

  const { data: tbFiles } = useQuery<any[]>({
    queryKey: ["/api/cashflow/tb-files"],
  });

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
      const res = await fetch("/api/cashflow/reprocess", { method: "POST" });
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
      const res = await fetch(`/api/cashflow/tb-file/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
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
      const res = await fetch("/api/cashflow/clear-tb", { method: "DELETE" });
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
      setClearTbDialogOpen(false);
    },
  });

  const clearMappingMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/cashflow/clear-mapping", { method: "DELETE" });
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
      setClearMappingDialogOpen(false);
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

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
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
                    <Download className="w-3 h-3 mr-1" /> Download
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={addTbSlot} data-testid="button-add-tb-slot">
                  <Plus className="w-3 h-3 mr-1" /> Add
                </Button>
                {(tbFiles?.length ?? 0) > 0 && (
                  <Button variant="outline" size="sm" onClick={() => setClearTbDialogOpen(true)} data-testid="button-clear-tb">
                    <Trash2 className="w-3 h-3 mr-1" /> Clear All
                  </Button>
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
                {tbFiles.map((f: any) => (
                  <div key={f.id} className="flex items-center justify-between border rounded p-2" data-testid={`uploaded-tb-${f.id}`}>
                    <div className="flex items-center gap-2 min-w-0">
                      <CheckCircle className="w-3.5 h-3.5 text-green-500 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-xs font-medium truncate">{f.enterprise || f.label}</p>
                        <p className="text-[10px] text-muted-foreground">{formatNum(f.totalRecords)} records · {f.period || "—"}</p>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                      onClick={() => deleteTbMutation.mutate(f.id)}
                      data-testid={`button-delete-tb-${f.id}`}
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                ))}
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
                    onClick={() => reprocessMutation.mutate()}
                    disabled={reprocessMutation.isPending}
                    data-testid="button-reprocess-cf"
                  >
                    {reprocessMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <RefreshCw className="w-3 h-3 mr-1" />}
                    Reprocess
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setClearMappingDialogOpen(true)} data-testid="button-clear-mapping">
                    <Trash2 className="w-3 h-3 mr-1" /> Clear
                  </Button>
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
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

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

      <Dialog open={clearTbDialogOpen} onOpenChange={setClearTbDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clear All TB Data</DialogTitle>
            <DialogDescription>
              This will remove all uploaded Trial Balance files and compiled data. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setClearTbDialogOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={() => clearTbMutation.mutate()} disabled={clearTbMutation.isPending}>
              {clearTbMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
              Clear All
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={clearMappingDialogOpen} onOpenChange={setClearMappingDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clear Mapping Data</DialogTitle>
            <DialogDescription>
              This will remove all cashflow groupings, entity mappings, and past losses data. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setClearMappingDialogOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={() => clearMappingMutation.mutate()} disabled={clearMappingMutation.isPending}>
              {clearMappingMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
              Clear All
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
