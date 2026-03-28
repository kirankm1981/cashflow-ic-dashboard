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
    if (tbSlots.length <= 2) return;
    setTbSlots(tbSlots.filter(s => s.id !== id));
  };

  const updateSlot = (id: string, updates: Partial<TbUploadSlot>) => {
    setTbSlots(tbSlots.map(s => s.id === id ? { ...s, ...updates } : s));
  };

  const handleDownload = () => {
    window.open("/api/ic-matrix/download", "_blank");
  };

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
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleDownload}
            disabled={!summary?.totalRecords}
            data-testid="button-download-compiled"
          >
            <Download className="w-4 h-4 mr-2" />
            Download Compiled TB
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={() => setClearTbDialogOpen(true)}
            disabled={!summary?.totalRecords}
            data-testid="button-clear-tb"
          >
            <Trash2 className="w-4 h-4 mr-2" />
            Delete TB Data
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={() => setClearMappingDialogOpen(true)}
            disabled={!mappingSummary?.glMappings && !mappingSummary?.companyMappings}
            data-testid="button-clear-mapping"
          >
            <Trash2 className="w-4 h-4 mr-2" />
            Delete Mapping File
          </Button>
        </div>
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

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card data-testid="card-tb-files-count">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">TB Files</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{summary?.tbFiles || 0}</p>
          </CardContent>
        </Card>
        <Card data-testid="card-total-records">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Records</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{formatNum(summary?.totalRecords || 0)}</p>
          </CardContent>
        </Card>
        <Card data-testid="card-gl-mappings">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">GL Mappings</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{formatNum(mappingSummary?.glMappings || 0)}</p>
          </CardContent>
        </Card>
        <Card data-testid="card-company-mappings">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Company Codes</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{formatNum(mappingSummary?.companyMappings || 0)}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Trial Balance Files</h2>
            <Button variant="outline" size="sm" onClick={addTbSlot} data-testid="button-add-tb">
              <Plus className="w-4 h-4 mr-1" />
              Add TB
            </Button>
          </div>

          {tbSlots.map((slot) => (
            <Card key={slot.id} data-testid={`card-tb-slot-${slot.id}`}>
              <CardContent className="pt-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FileSpreadsheet className="w-5 h-5 text-blue-500" />
                    <Input
                      value={slot.label}
                      onChange={(e) => updateSlot(slot.id, { label: e.target.value })}
                      className="h-8 w-32 text-sm font-medium"
                      data-testid={`input-tb-label-${slot.id}`}
                    />
                  </div>
                  {tbSlots.length > 2 && (
                    <Button variant="ghost" size="sm" onClick={() => removeTbSlot(slot.id)} data-testid={`button-remove-tb-${slot.id}`}>
                      <X className="w-4 h-4" />
                    </Button>
                  )}
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Excel File (.xlsx)</Label>
                  <Input
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={(e) => updateSlot(slot.id, { file: e.target.files?.[0] || null })}
                    className="mt-1"
                    data-testid={`input-tb-file-${slot.id}`}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs text-muted-foreground">Period Start (optional override)</Label>
                    <Input
                      type="text"
                      placeholder="e.g. 1/4/2025"
                      value={slot.periodStart}
                      onChange={(e) => updateSlot(slot.id, { periodStart: e.target.value })}
                      className="mt-1 h-8 text-sm"
                      data-testid={`input-tb-period-start-${slot.id}`}
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Period End (optional override)</Label>
                    <Input
                      type="text"
                      placeholder="e.g. 31/12/2025"
                      value={slot.periodEnd}
                      onChange={(e) => updateSlot(slot.id, { periodEnd: e.target.value })}
                      className="mt-1 h-8 text-sm"
                      data-testid={`input-tb-period-end-${slot.id}`}
                    />
                  </div>
                </div>
                <Button
                  size="sm"
                  onClick={() => wrappedTbUpload(slot)}
                  disabled={!slot.file || uploadingSlots.has(slot.id)}
                  data-testid={`button-upload-tb-${slot.id}`}
                >
                  {uploadingSlots.has(slot.id) ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Upload className="w-4 h-4 mr-2" />
                  )}
                  Upload {slot.label}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Mapping File</h2>
          <Card>
            <CardContent className="pt-4 space-y-3">
              <div className="flex items-center gap-2">
                <Database className="w-5 h-5 text-purple-500" />
                <span className="text-sm font-medium">IC Mapping File</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Upload Excel file with "IC-GL-Mapping" and "Company_Code" sheets
              </p>
              <Input
                ref={mappingInputRef}
                type="file"
                accept=".xlsx,.xls"
                className="mt-1"
                data-testid="input-mapping-file"
              />
              <Button
                size="sm"
                onClick={wrappedMappingUpload}
                disabled={mappingUploading}
                data-testid="button-upload-mapping"
              >
                {mappingUploading ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Upload className="w-4 h-4 mr-2" />
                )}
                Upload Mapping
              </Button>
              {mappingSummary && (mappingSummary.glMappings > 0 || mappingSummary.companyMappings > 0) && (
                <div className="pt-2 space-y-1">
                  <div className="flex items-center gap-2 text-xs">
                    <CheckCircle className="w-3.5 h-3.5 text-green-500" />
                    <span>{formatNum(mappingSummary.glMappings)} GL mappings loaded</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <CheckCircle className="w-3.5 h-3.5 text-green-500" />
                    <span>{formatNum(mappingSummary.companyMappings)} company codes loaded</span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {(summary?.totalRecords > 0 && (mappingSummary?.glMappings > 0 || mappingSummary?.companyMappings > 0)) && (
            <Card>
              <CardContent className="pt-4 space-y-3">
                <div className="flex items-center gap-2">
                  <RefreshCw className="w-5 h-5 text-orange-500" />
                  <span className="text-sm font-medium">Reprocess Data</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Re-apply mapping lookups to all existing TB data after uploading updated mappings
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => reprocessMutation.mutate()}
                  disabled={reprocessMutation.isPending}
                  data-testid="button-reprocess"
                >
                  {reprocessMutation.isPending ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <RefreshCw className="w-4 h-4 mr-2" />
                  )}
                  Reprocess All Data
                </Button>
              </CardContent>
            </Card>
          )}

          {summary?.files && summary.files.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Uploaded TB Files</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {summary.files.map((f: any) => (
                  <div key={f.id} className="flex items-center justify-between p-2 rounded-md bg-muted/50">
                    <div>
                      <p className="text-sm font-medium">{f.label}</p>
                      <p className="text-xs text-muted-foreground">{f.fileName} - {formatNum(f.records)} records</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive h-7 w-7 p-0"
                      onClick={() => deleteTbMutation.mutate(f.id)}
                      disabled={deleteTbMutation.isPending}
                      data-testid={`button-delete-tb-${f.id}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <Dialog open={clearTbDialogOpen} onOpenChange={setClearTbDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete TB Data</DialogTitle>
            <DialogDescription>
              This will permanently delete all uploaded Trial Balance files and their compiled data. Mapping data will be preserved. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setClearTbDialogOpen(false)} data-testid="button-clear-tb-cancel">
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => clearTbMutation.mutate()}
              disabled={clearTbMutation.isPending}
              data-testid="button-clear-tb-confirm"
            >
              {clearTbMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Trash2 className="w-4 h-4 mr-2" />}
              Delete TB Data
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={clearMappingDialogOpen} onOpenChange={setClearMappingDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Mapping File</DialogTitle>
            <DialogDescription>
              This will permanently delete all GL mappings and company code mappings. TB data will be preserved but will need remapping. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setClearMappingDialogOpen(false)} data-testid="button-clear-mapping-cancel">
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => clearMappingMutation.mutate()}
              disabled={clearMappingMutation.isPending}
              data-testid="button-clear-mapping-confirm"
            >
              {clearMappingMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Trash2 className="w-4 h-4 mr-2" />}
              Delete Mapping File
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
