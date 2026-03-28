import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useUploadManager } from "@/lib/upload-manager";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Upload,
  FileSpreadsheet,
  Trash2,
  Loader2,
  CheckCircle,
  Plus,
  X,
  Database,
  LinkIcon,
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
    if (glSlots.length <= 2) return;
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
        <div className="flex gap-2">
          {hasGlFiles && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                window.open("/api/recon/download-mapped-data", "_blank");
              }}
              data-testid="button-download-mapped"
            >
              <Download className="w-4 h-4 mr-2" />
              Download Mapped Data
            </Button>
          )}
          {hasGlFiles && (
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => setClearGlDialogOpen(true)}
              data-testid="button-clear-gl"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Delete GL Data
            </Button>
          )}
          {hasMappings && (
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => setClearMappingDialogOpen(true)}
              data-testid="button-clear-mapping"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Delete Mapping File
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card data-testid="card-gl-files-count">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">GL Files</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{glFiles?.length || 0}</p>
          </CardContent>
        </Card>
        <Card data-testid="card-total-transactions">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Transactions</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{formatNum(totalTransactions)}</p>
          </CardContent>
        </Card>
        <Card data-testid="card-ic-records">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">IC Records</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{formatNum(totalIcRecords)}</p>
          </CardContent>
        </Card>
        <Card data-testid="card-mapping-status">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Mapping Status</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{hasMappings ? "Ready" : "Not Loaded"}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">GL Dump Files</h2>
            <Button variant="outline" size="sm" onClick={addGlSlot} data-testid="button-add-gl">
              <Plus className="w-4 h-4 mr-1" />
              Add GL Dump
            </Button>
          </div>

          {glSlots.map((slot) => (
            <Card key={slot.id} data-testid={`card-gl-slot-${slot.id}`}>
              <CardContent className="pt-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FileSpreadsheet className="w-5 h-5 text-blue-500" />
                    <Input
                      value={slot.label}
                      onChange={(e) => updateSlot(slot.id, { label: e.target.value })}
                      className="h-8 w-36 text-sm font-medium"
                      data-testid={`input-gl-label-${slot.id}`}
                    />
                  </div>
                  {glSlots.length > 2 && (
                    <Button variant="ghost" size="sm" onClick={() => removeGlSlot(slot.id)} data-testid={`button-remove-gl-${slot.id}`}>
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
                    data-testid={`input-gl-file-${slot.id}`}
                  />
                </div>
                <Button
                  onClick={() => wrappedGlUpload(slot)}
                  disabled={!slot.file || uploadingSlots.has(slot.id) || !hasMappings}
                  size="sm"
                  data-testid={`button-upload-gl-${slot.id}`}
                >
                  {uploadingSlots.has(slot.id) ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Uploading...
                    </>
                  ) : (
                    <>
                      <Upload className="w-4 h-4 mr-2" />
                      Upload & Process
                    </>
                  )}
                </Button>
                {!hasMappings && slot.file && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">Upload or link the mapping file first before uploading GL dumps.</p>
                )}
              </CardContent>
            </Card>
          ))}

          {hasGlFiles && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-muted-foreground">Uploaded GL Files</h3>
              {glFiles!.map((f: any) => (
                <Card key={f.id} className="border-green-200 dark:border-green-800 bg-green-50/30 dark:bg-green-950/10" data-testid={`card-gl-file-${f.id}`}>
                  <CardContent className="py-3 px-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <CheckCircle className="w-4 h-4 text-green-600 shrink-0" />
                      <div>
                        <p className="text-sm font-medium">{f.label}</p>
                        <p className="text-xs text-muted-foreground">
                          {f.fileName} — {formatNum(f.icRecords)} IC records from {formatNum(f.totalRecords)} transactions
                        </p>
                        {(f.enterpriseName || f.reportPeriod) && (
                          <p className="text-xs text-muted-foreground mt-0.5">
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
                      onClick={() => deleteGlFileMutation.mutate(f.id)}
                      disabled={deleteGlFileMutation.isPending}
                      data-testid={`button-delete-gl-file-${f.id}`}
                    >
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Mapping File</h2>

          {hasMappings ? (
            <Card className="border-green-200 dark:border-green-800 bg-green-50/30 dark:bg-green-950/10">
              <CardContent className="pt-4 space-y-3">
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-5 h-5 text-green-600" />
                  <span className="text-sm font-semibold">Mapping Loaded</span>
                </div>
                <div className="text-xs text-muted-foreground space-y-1">
                  <div className="flex justify-between">
                    <span>GL Mappings</span>
                    <span className="font-medium">{mappingStatus?.glMappings || 0}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Company Codes</span>
                    <span className="font-medium">{mappingStatus?.companyMappings || 0}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400">
                  <LinkIcon className="w-3 h-3" />
                  <span>Shared with IC Matrix module</span>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="pt-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Database className="w-5 h-5 text-orange-500" />
                  <span className="text-sm font-semibold">IC Mapping File</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Upload the mapping file with IC-GL-Mapping and Company_Code sheets. This is shared with the IC Matrix module.
                </p>
                <div>
                  <Label className="text-xs text-muted-foreground">Excel File (.xlsx)</Label>
                  <Input
                    type="file"
                    accept=".xlsx,.xls"
                    ref={mappingInputRef}
                    className="mt-1"
                    data-testid="input-mapping-file"
                  />
                </div>
                <Button
                  onClick={wrappedMappingUpload}
                  disabled={mappingUploading}
                  size="sm"
                  className="w-full"
                  data-testid="button-upload-mapping"
                >
                  {mappingUploading ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    <>
                      <Upload className="w-4 h-4 mr-2" />
                      Upload Mapping
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>
          )}

          {hasMappings && (
            <Card>
              <CardContent className="pt-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Database className="w-5 h-5 text-blue-500" />
                  <span className="text-sm font-semibold">Update Mapping</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Upload a new mapping file to replace the existing one.
                </p>
                <div>
                  <Label className="text-xs text-muted-foreground">Excel File (.xlsx)</Label>
                  <Input
                    type="file"
                    accept=".xlsx,.xls"
                    ref={mappingInputRef}
                    className="mt-1"
                    data-testid="input-mapping-file"
                  />
                </div>
                <Button
                  onClick={wrappedMappingUpload}
                  disabled={mappingUploading}
                  size="sm"
                  variant="outline"
                  className="w-full"
                  data-testid="button-upload-mapping"
                >
                  {mappingUploading ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    <>
                      <Upload className="w-4 h-4 mr-2" />
                      Replace Mapping
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <Dialog open={clearGlDialogOpen} onOpenChange={setClearGlDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete GL Data</DialogTitle>
            <DialogDescription>
              This will permanently delete all uploaded GL dump data, transactions, and reconciliation results. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setClearGlDialogOpen(false)} data-testid="button-clear-cancel">
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => clearAllGlMutation.mutate()}
              disabled={clearAllGlMutation.isPending}
              data-testid="button-clear-confirm"
            >
              {clearAllGlMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete All GL Data
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={clearMappingDialogOpen} onOpenChange={setClearMappingDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Mapping File</DialogTitle>
            <DialogDescription>
              This will permanently delete all GL mapping and Company Code mapping data. This mapping is shared with the IC Matrix module. This action cannot be undone.
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
              {clearMappingMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete Mapping
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
