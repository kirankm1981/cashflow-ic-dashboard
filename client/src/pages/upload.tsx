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
  Database,
  Download,
  AlertCircle,
  CheckCircle,
  LinkIcon,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { UploadBatch } from "@shared/schema";

function formatNum(val: number | null | undefined): string {
  if (val === null || val === undefined) return "0";
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(val);
}

interface GlUploadSlot {
  id: string;
  label: string;
  file: File | null;
}

export default function UploadPage() {
  const { toast } = useToast();
  const { uploadGlFile, uploadMappingFile, notifications } = useUploadManager();
  const reconNotifications = notifications.filter(n => n.module === "recon");
  const [clearGlDialogOpen, setClearGlDialogOpen] = useState(false);
  const [clearMappingDialogOpen, setClearMappingDialogOpen] = useState(false);
  const [uploadingSlots, setUploadingSlots] = useState<Set<string>>(new Set());
  const [mappingUploading, setMappingUploading] = useState(false);
  const mappingInputRef = useRef<HTMLInputElement>(null);
  const [glSlots, setGlSlots] = useState<GlUploadSlot[]>([
    { id: "1", label: "GL Dump 1", file: null },
    { id: "2", label: "GL Dump 2", file: null },
  ]);

  const { data: glFiles } = useQuery<any[]>({
    queryKey: ["/api/recon/gl-files"],
  });

  const { data: mappingStatus } = useQuery<any>({
    queryKey: ["/api/recon/mapping-status"],
  });

  const { data: icMatrixMappingSummary } = useQuery<any>({
    queryKey: ["/api/ic-matrix/mapping-summary"],
  });

  const wrappedGlUpload = async (slot: GlUploadSlot) => {
    if (!slot.file) return;
    setUploadingSlots(prev => new Set(prev).add(slot.id));
    try {
      await uploadGlFile(slot.file, slot.label, slot.id);
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

  const deleteGlFileMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/recon/gl-file/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "GL File Deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/recon/gl-files"] });
      queryClient.invalidateQueries({ queryKey: ["/api/upload-batches"] });
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/counterparties"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company-pairs"] });
    },
  });

  const clearAllGlMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/transactions/clear", { method: "POST" });
      if (!res.ok) throw new Error("Clear failed");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "GL Data Cleared" });
      setClearGlDialogOpen(false);
      queryClient.invalidateQueries({ queryKey: ["/api/recon/gl-files"] });
      queryClient.invalidateQueries({ queryKey: ["/api/upload-batches"] });
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/counterparties"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company-pairs"] });
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
      queryClient.invalidateQueries({ queryKey: ["/api/recon/mapping-status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ic-matrix/mapping-summary"] });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const addGlSlot = () => {
    const nextNum = glSlots.length + 1;
    setGlSlots([...glSlots, { id: String(Date.now()), label: `GL Dump ${nextNum}`, file: null }]);
  };

  const removeGlSlot = (id: string) => {
    if (glSlots.length <= 1) return;
    setGlSlots(glSlots.filter(s => s.id !== id));
  };

  const updateSlot = (id: string, updates: Partial<GlUploadSlot>) => {
    setGlSlots(glSlots.map(s => s.id === id ? { ...s, ...updates } : s));
  };

  const hasGlFiles = glFiles && glFiles.length > 0;
  const hasMappings = mappingStatus?.hasMapping;
  const totalIcRecords = glFiles?.reduce((sum: number, f: any) => sum + (f.icRecords || 0), 0) || 0;
  const totalTransactions = glFiles?.reduce((sum: number, f: any) => sum + (f.totalRecords || 0), 0) || 0;

  return (
    <div className="p-6 space-y-6" data-testid="page-recon-upload">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">
            IC Recon - Upload
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Upload GL Dump files and mapping data for intercompany reconciliation
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">GL Files</p>
            <p className="text-2xl font-bold mt-1" data-testid="text-gl-files-count">{glFiles?.length || 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Transactions</p>
            <p className="text-2xl font-bold mt-1" data-testid="text-total-transactions">{formatNum(totalTransactions)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">IC Records</p>
            <p className="text-2xl font-bold mt-1" data-testid="text-ic-records">{formatNum(totalIcRecords)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Mapping Status</p>
            <p className="text-2xl font-bold mt-1" data-testid="text-mapping-status">{hasMappings ? "Ready" : "Not Loaded"}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <FileSpreadsheet className="w-4 h-4" />
                GL Dump Files
              </CardTitle>
              <div className="flex gap-2">
                {hasGlFiles && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => window.open("/api/recon/download-mapped-data", "_blank")}
                    data-testid="button-download-mapped"
                  >
                    <Download className="w-3 h-3 mr-1" /> Download
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={addGlSlot} data-testid="button-add-gl">
                  <Plus className="w-3 h-3 mr-1" /> Add
                </Button>
                {hasGlFiles && (
                  <Button variant="outline" size="sm" onClick={() => setClearGlDialogOpen(true)} data-testid="button-clear-gl">
                    <Trash2 className="w-3 h-3 mr-1" /> Clear All
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {glSlots.map((slot) => (
              <div key={slot.id} className="border rounded-lg p-3 space-y-2" data-testid={`slot-gl-${slot.id}`}>
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">{slot.label}</Label>
                  {glSlots.length > 1 && (
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => removeGlSlot(slot.id)}>
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
                    data-testid={`input-gl-file-${slot.id}`}
                  />
                  <Button
                    size="sm"
                    disabled={!slot.file || uploadingSlots.has(slot.id) || !hasMappings}
                    onClick={() => wrappedGlUpload(slot)}
                    data-testid={`button-upload-gl-${slot.id}`}
                  >
                    {uploadingSlots.has(slot.id) ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3 mr-1" />}
                    Upload
                  </Button>
                </div>
                {!hasMappings && slot.file && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">Upload the mapping file first before uploading GL dumps.</p>
                )}
              </div>
            ))}

            {hasGlFiles && (
              <div className="mt-4 space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Uploaded Files</p>
                {glFiles!.map((f: any) => (
                  <div key={f.id} className="flex items-center justify-between border rounded p-2" data-testid={`uploaded-gl-${f.id}`}>
                    <div className="flex items-center gap-2 min-w-0">
                      <CheckCircle className="w-3.5 h-3.5 text-green-500 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-xs font-medium truncate">{f.label}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {f.fileName} — {formatNum(f.icRecords)} IC / {formatNum(f.totalRecords)} total
                        </p>
                        {(f.enterpriseName || f.reportPeriod) && (
                          <p className="text-[10px] text-muted-foreground">
                            {f.enterpriseName && <span className="font-medium">{f.enterpriseName}</span>}
                            {f.enterpriseName && f.reportPeriod && <span> · </span>}
                            {f.reportPeriod && <span>{f.reportPeriod}</span>}
                          </p>
                        )}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                      onClick={() => deleteGlFileMutation.mutate(f.id)}
                      disabled={deleteGlFileMutation.isPending}
                      data-testid={`button-delete-gl-file-${f.id}`}
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

            {mappingStatus && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Mapping Status</p>
                <div className="grid grid-cols-1 gap-2">
                  <div className="flex items-center justify-between border rounded p-2">
                    <div className="flex items-center gap-2">
                      {(mappingStatus.glMappings || 0) > 0 ? (
                        <CheckCircle className="w-3.5 h-3.5 text-green-500" />
                      ) : (
                        <AlertCircle className="w-3.5 h-3.5 text-amber-500" />
                      )}
                      <span className="text-xs">GL Mappings</span>
                    </div>
                    <Badge variant={(mappingStatus.glMappings || 0) > 0 ? "default" : "secondary"} className="text-[10px]">
                      {formatNum(mappingStatus.glMappings || 0)} mappings
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between border rounded p-2">
                    <div className="flex items-center gap-2">
                      {(mappingStatus.companyMappings || 0) > 0 ? (
                        <CheckCircle className="w-3.5 h-3.5 text-green-500" />
                      ) : (
                        <AlertCircle className="w-3.5 h-3.5 text-amber-500" />
                      )}
                      <span className="text-xs">Company Codes</span>
                    </div>
                    <Badge variant={(mappingStatus.companyMappings || 0) > 0 ? "default" : "secondary"} className="text-[10px]">
                      {formatNum(mappingStatus.companyMappings || 0)} codes
                    </Badge>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400 mt-2">
                  <LinkIcon className="w-3 h-3" />
                  <span>Shared with IC Matrix module</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {reconNotifications.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Upload Activity</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {reconNotifications.map(n => (
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

      <Dialog open={clearGlDialogOpen} onOpenChange={setClearGlDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clear All GL Data</DialogTitle>
            <DialogDescription>
              This will permanently delete all uploaded GL dump data, transactions, and reconciliation results. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setClearGlDialogOpen(false)} data-testid="button-clear-cancel">
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => clearAllGlMutation.mutate()}
              disabled={clearAllGlMutation.isPending}
              data-testid="button-clear-confirm"
            >
              {clearAllGlMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
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
              This will permanently delete all GL mapping and Company Code mapping data. This mapping is shared with the IC Matrix module. This action cannot be undone.
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
