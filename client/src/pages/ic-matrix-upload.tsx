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
  Download,
  Plus,
  X,
  RefreshCw,
  Database,
  AlertCircle,
  CheckCircle,
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
  periodStart: string;
  periodEnd: string;
}

export default function IcMatrixUpload() {
  const { toast } = useToast();
  const { uploadTbFile, uploadMappingFile, notifications } = useUploadManager();
  const matrixNotifications = notifications.filter(n => n.module === "ic-matrix");
  const [clearTbDialogOpen, setClearTbDialogOpen] = useState(false);
  const [clearMappingDialogOpen, setClearMappingDialogOpen] = useState(false);
  const [uploadingSlots, setUploadingSlots] = useState<Set<string>>(new Set());
  const [mappingUploading, setMappingUploading] = useState(false);
  const mappingInputRef = useRef<HTMLInputElement>(null);
  const [tbSlots, setTbSlots] = useState<TbUploadSlot[]>([
    { id: "1", label: "TB 1", file: null, periodStart: "", periodEnd: "" },
    { id: "2", label: "TB 2", file: null, periodStart: "", periodEnd: "" },
  ]);

  const { data: summary } = useQuery<any>({
    queryKey: ["/api/ic-matrix/summary"],
  });

  const { data: mappingSummary } = useQuery<any>({
    queryKey: ["/api/ic-matrix/mapping-summary"],
  });

  const wrappedTbUpload = async (slot: TbUploadSlot) => {
    if (!slot.file) return;
    setUploadingSlots(prev => new Set(prev).add(slot.id));
    try {
      await uploadTbFile(slot.file, slot.label, slot.id, slot.periodStart || undefined, slot.periodEnd || undefined);
    } finally {
      setUploadingSlots(prev => { const s = new Set(prev); s.delete(slot.id); return s; });
    }
  };

  const wrappedMappingUpload = async () => {
    const file = mappingInputRef.current?.files?.[0];
    if (!file) return;
    setMappingUploading(true);
    try {
      await uploadMappingFile(file);
    } finally {
      setMappingUploading(false);
    }
  };

  const reprocessMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/ic-matrix/reprocess", { method: "POST" });
      if (!res.ok) throw new Error("Reprocess failed");
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Reprocessed", description: `${formatNum(data.updated)} records updated with latest mappings` });
      queryClient.invalidateQueries({ queryKey: ["/api/ic-matrix/tb-data"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ic-matrix/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ic-matrix/dashboard"] });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteTbMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/ic-matrix/tb-file/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "TB File Deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/ic-matrix/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ic-matrix/tb-files"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ic-matrix/tb-data"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ic-matrix/dashboard"] });
    },
  });

  const clearTbMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/ic-matrix/clear-tb", { method: "POST" });
      if (!res.ok) throw new Error("Clear failed");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "TB Data Cleared" });
      setClearTbDialogOpen(false);
      queryClient.invalidateQueries({ queryKey: ["/api/ic-matrix"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ic-matrix/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ic-matrix/tb-files"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ic-matrix/tb-data"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ic-matrix/dashboard"] });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const clearMappingMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/ic-matrix/clear-mapping", { method: "POST" });
      if (!res.ok) throw new Error("Clear failed");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Mapping Data Cleared" });
      setClearMappingDialogOpen(false);
      queryClient.invalidateQueries({ queryKey: ["/api/ic-matrix"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ic-matrix/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ic-matrix/mapping-summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ic-matrix/dashboard"] });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const addTbSlot = () => {
    const nextNum = tbSlots.length + 1;
    setTbSlots([...tbSlots, { id: String(Date.now()), label: `TB ${nextNum}`, file: null, periodStart: "", periodEnd: "" }]);
  };

  const removeTbSlot = (id: string) => {
    if (tbSlots.length <= 1) return;
    setTbSlots(tbSlots.filter(s => s.id !== id));
  };

  const updateSlot = (id: string, updates: Partial<TbUploadSlot>) => {
    setTbSlots(tbSlots.map(s => s.id === id ? { ...s, ...updates } : s));
  };

  const handleDownload = () => {
    window.open("/api/ic-matrix/download", "_blank");
  };

  const hasTbData = (summary?.totalRecords || 0) > 0;
  const hasMappings = (mappingSummary?.glMappings || 0) > 0 || (mappingSummary?.companyMappings || 0) > 0;

  return (
    <div className="p-6 space-y-6" data-testid="page-ic-matrix-upload">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-ic-matrix-upload-title">
            IC Matrix - Upload
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Upload Trial Balance files and mapping data for IC Matrix compilation
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">TB Files</p>
            <p className="text-2xl font-bold mt-1" data-testid="text-tb-files-count">{summary?.tbFiles || 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Records</p>
            <p className="text-2xl font-bold mt-1" data-testid="text-total-records">{formatNum(summary?.totalRecords || 0)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">GL Mappings</p>
            <p className="text-2xl font-bold mt-1" data-testid="text-gl-mappings">{formatNum(mappingSummary?.glMappings || 0)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Company Codes</p>
            <p className="text-2xl font-bold mt-1" data-testid="text-company-codes">{formatNum(mappingSummary?.companyMappings || 0)}</p>
          </CardContent>
        </Card>
      </div>

      {summary && summary.period && (
        <Card className="border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20">
          <CardContent className="py-3 px-4 flex items-center gap-2">
            <Badge variant="outline" className="text-blue-700 dark:text-blue-300 border-blue-300 dark:border-blue-700">
              Report Period
            </Badge>
            <span className="text-sm font-medium" data-testid="text-report-period">{summary.period}</span>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <FileSpreadsheet className="w-4 h-4" />
                Trial Balance Files
              </CardTitle>
              <div className="flex gap-2">
                {hasTbData && (
                  <Button variant="outline" size="sm" onClick={handleDownload} data-testid="button-download-compiled">
                    <Download className="w-3 h-3 mr-1" /> Download
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={addTbSlot} data-testid="button-add-tb">
                  <Plus className="w-3 h-3 mr-1" /> Add
                </Button>
                {hasTbData && (
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
                    onChange={(e) => updateSlot(slot.id, { file: e.target.files?.[0] || null })}
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
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-[10px] text-muted-foreground">Period Start (optional)</Label>
                    <Input
                      type="text"
                      placeholder="e.g. 1/4/2025"
                      value={slot.periodStart}
                      onChange={(e) => updateSlot(slot.id, { periodStart: e.target.value })}
                      className="h-7 text-xs"
                      data-testid={`input-tb-period-start-${slot.id}`}
                    />
                  </div>
                  <div>
                    <Label className="text-[10px] text-muted-foreground">Period End (optional)</Label>
                    <Input
                      type="text"
                      placeholder="e.g. 31/12/2025"
                      value={slot.periodEnd}
                      onChange={(e) => updateSlot(slot.id, { periodEnd: e.target.value })}
                      className="h-7 text-xs"
                      data-testid={`input-tb-period-end-${slot.id}`}
                    />
                  </div>
                </div>
              </div>
            ))}

            {summary?.files && summary.files.length > 0 && (
              <div className="mt-4 space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Uploaded Files</p>
                {summary.files.map((f: any) => (
                  <div key={f.id} className="flex items-center justify-between border rounded p-2" data-testid={`uploaded-tb-${f.id}`}>
                    <div className="flex items-center gap-2 min-w-0">
                      <CheckCircle className="w-3.5 h-3.5 text-green-500 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-xs font-medium truncate">{f.label}</p>
                        <p className="text-[10px] text-muted-foreground">{f.fileName} — {formatNum(f.records)} records</p>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                      onClick={() => deleteTbMutation.mutate(f.id)}
                      disabled={deleteTbMutation.isPending}
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
                IC Mapping File
              </CardTitle>
              {hasMappings && (
                <div className="flex gap-2">
                  {hasTbData && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => reprocessMutation.mutate()}
                      disabled={reprocessMutation.isPending}
                      data-testid="button-reprocess"
                    >
                      {reprocessMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <RefreshCw className="w-3 h-3 mr-1" />}
                      Reprocess
                    </Button>
                  )}
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
                Excel file with sheets: "IC-GL-Mapping", "Company_Code"
              </p>
              <div className="flex gap-2">
                <Input
                  ref={mappingInputRef}
                  type="file"
                  accept=".xlsx,.xls"
                  className="flex-1 text-xs"
                  data-testid="input-mapping-file"
                />
                <Button
                  size="sm"
                  disabled={mappingUploading}
                  onClick={wrappedMappingUpload}
                  data-testid="button-upload-mapping"
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
                      {(mappingSummary.glMappings || 0) > 0 ? (
                        <CheckCircle className="w-3.5 h-3.5 text-green-500" />
                      ) : (
                        <AlertCircle className="w-3.5 h-3.5 text-amber-500" />
                      )}
                      <span className="text-xs">GL Mappings (IC Counter Party / Txn Type)</span>
                    </div>
                    <Badge variant={(mappingSummary.glMappings || 0) > 0 ? "default" : "secondary"} className="text-[10px]">
                      {formatNum(mappingSummary.glMappings || 0)} mappings
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between border rounded p-2">
                    <div className="flex items-center gap-2">
                      {(mappingSummary.companyMappings || 0) > 0 ? (
                        <CheckCircle className="w-3.5 h-3.5 text-green-500" />
                      ) : (
                        <AlertCircle className="w-3.5 h-3.5 text-amber-500" />
                      )}
                      <span className="text-xs">Company Codes</span>
                    </div>
                    <Badge variant={(mappingSummary.companyMappings || 0) > 0 ? "default" : "secondary"} className="text-[10px]">
                      {formatNum(mappingSummary.companyMappings || 0)} codes
                    </Badge>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {matrixNotifications.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Upload Activity</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {matrixNotifications.map(n => (
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
              This will permanently delete all uploaded Trial Balance files and their compiled data. Mapping data will be preserved. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setClearTbDialogOpen(false)} data-testid="button-clear-tb-cancel">
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => clearTbMutation.mutate()}
              disabled={clearTbMutation.isPending}
              data-testid="button-clear-tb-confirm"
            >
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
              This will permanently delete all GL mappings and company code mappings. TB data will be preserved but will need remapping. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setClearMappingDialogOpen(false)} data-testid="button-clear-mapping-cancel">
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => clearMappingMutation.mutate()}
              disabled={clearMappingMutation.isPending}
              data-testid="button-clear-mapping-confirm"
            >
              {clearMappingMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
              Clear All
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
