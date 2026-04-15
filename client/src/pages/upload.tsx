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
  Play,
  Clock,
} from "lucide-react";
import { ConfirmDestructiveDialog } from "@/components/confirm-destructive-dialog";
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
  const [uploadingSlots, setUploadingSlots] = useState<Set<string>>(new Set());
  const [mappingUploading, setMappingUploading] = useState(false);
  const mappingInputRef = useRef<HTMLInputElement>(null);
  const [glSlots, setGlSlots] = useState<GlUploadSlot[]>([
    { id: "1", label: "GL Dump 1", file: null },
    { id: "2", label: "GL Dump 2", file: null },
  ]);

  const hasActiveFiles = (files?: any[]) => files?.some((f: any) => ["parsing", "inserting", "processing"].includes(f.status));
  const [forcePolling, setForcePolling] = useState(false);

  const { data: glFiles } = useQuery<any[]>({
    queryKey: ["/api/recon/gl-files"],
    refetchInterval: (query) => {
      const data = query.state.data as any[] | undefined;
      if (hasActiveFiles(data) || forcePolling) return 2000;
      return 30000;
    },
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
    setForcePolling(true);
    try {
      await uploadGlFile(slot.file, slot.label, slot.id);
      queryClient.invalidateQueries({ queryKey: ["/api/recon/gl-files"] });
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
      const res = await fetch(`/api/recon/gl-file/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        throw new Error(errBody || `Delete failed (${res.status})`);
      }
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
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const clearAllGlMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/transactions/clear", { method: "POST", credentials: "include" });
      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        throw new Error(errBody || `Clear failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "GL Data Cleared" });
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
      const res = await fetch("/api/ic-matrix/clear-mapping", { method: "POST", credentials: "include" });
      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        throw new Error(errBody || `Clear failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Mapping Data Cleared" });
      queryClient.invalidateQueries({ queryKey: ["/api/recon/mapping-status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ic-matrix/mapping-summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ic-matrix/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ic-matrix/dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ic-matrix/tb-data"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/summarized-lines"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company-pairs"] });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const processGlMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/recon/process-gl", { method: "POST", credentials: "include" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ message: "Processing failed" }));
        throw new Error(data.message);
      }
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({ title: "Processing Started", description: `${data.filesQueued} file(s) queued for processing. Progress will update automatically.` });
      queryClient.invalidateQueries({ queryKey: ["/api/recon/gl-files"] });
    },
    onError: (error: any) => {
      toast({ title: "Processing Error", description: error.message, variant: "destructive" });
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

  const prevActiveRef = useRef(0);
  useEffect(() => {
    const currentActive = glFiles?.filter((f: any) => ["parsing", "inserting", "processing"].includes(f.status)).length || 0;
    if (prevActiveRef.current > 0 && currentActive === 0 && glFiles && glFiles.length > 0) {
      setForcePolling(false);
      queryClient.invalidateQueries({ queryKey: ["/api/upload-batches"] });
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/counterparties"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company-pairs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/summarized-lines"] });
    }
    prevActiveRef.current = currentActive;
  }, [glFiles]);

  const hasGlFiles = glFiles && glFiles.length > 0;
  const hasMappings = mappingStatus?.hasMapping;
  const totalIcRecords = glFiles?.reduce((sum: number, f: any) => sum + (f.icRecords || 0), 0) || 0;
  const totalTransactions = glFiles?.reduce((sum: number, f: any) => sum + (f.totalRecords || 0), 0) || 0;
  const readyToProcessCount = glFiles?.filter((f: any) => !f.processed && f.status === "uploaded").length || 0;
  const activeCount = glFiles?.filter((f: any) => ["parsing", "inserting", "processing"].includes(f.status)).length || 0;
  const unprocessedCount = glFiles?.filter((f: any) => !f.processed).length || 0;
  const hasUnprocessed = unprocessedCount > 0;

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
                  <ConfirmDestructiveDialog
                    trigger={
                      <Button variant="outline" size="sm" data-testid="button-clear-gl">
                        <Trash2 className="w-3 h-3 mr-1" /> Clear All
                      </Button>
                    }
                    title="Clear All GL Data"
                    description="This will permanently delete all uploaded GL dump data, transactions, and reconciliation results. This action cannot be undone."
                    confirmWord="DELETE"
                    onConfirm={() => clearAllGlMutation.mutate()}
                    isPending={clearAllGlMutation.isPending}
                  />
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
                    disabled={!slot.file || uploadingSlots.has(slot.id)}
                    onClick={() => wrappedGlUpload(slot)}
                    data-testid={`button-upload-gl-${slot.id}`}
                  >
                    {uploadingSlots.has(slot.id) ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3 mr-1" />}
                    Upload
                  </Button>
                </div>
              </div>
            ))}

            {hasGlFiles && (
              <div className="mt-4 space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Uploaded Files</p>
                {glFiles!.map((f: any) => {
                  const isActive = ["parsing", "inserting", "processing"].includes(f.status);
                  const isError = f.status === "error";
                  return (
                  <div key={f.id} className={`flex items-center justify-between border rounded p-2 ${isError ? "border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-950/20" : ""}`} data-testid={`uploaded-gl-${f.id}`}>
                    <div className="flex items-center gap-2 min-w-0">
                      {isActive ? (
                        <Loader2 className="w-3.5 h-3.5 text-blue-500 animate-spin shrink-0" />
                      ) : isError ? (
                        <AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                      ) : f.processed ? (
                        <CheckCircle className="w-3.5 h-3.5 text-green-500 shrink-0" />
                      ) : (
                        <Clock className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                      )}
                      <div className="min-w-0">
                        <p className="text-xs font-medium truncate">{f.label}</p>
                        <div className="text-[10px] text-muted-foreground">
                          {f.fileName}
                          {f.totalRecords > 0 && <span> — {f.processed ? `${formatNum(f.icRecords)} IC / ` : ""}{formatNum(f.totalRecords)} total</span>}
                          {isActive && <Badge variant="outline" className="ml-1 text-[9px] px-1 py-0 text-blue-600 border-blue-300 dark:text-blue-400 dark:border-blue-600">{f.status === "parsing" ? "Parsing" : f.status === "inserting" ? "Saving" : "Processing"}</Badge>}
                          {isError && <Badge variant="outline" className="ml-1 text-[9px] px-1 py-0 text-red-600 border-red-300">Error</Badge>}
                          {!f.processed && !isActive && !isError && f.status === "uploaded" && <Badge variant="outline" className="ml-1 text-[9px] px-1 py-0 text-amber-600 border-amber-300">Pending</Badge>}
                        </div>
                        {f.statusMessage && isActive && (
                          <p className="text-[10px] text-blue-600 dark:text-blue-400">{f.statusMessage}</p>
                        )}
                        {f.statusMessage && isError && (
                          <p className="text-[10px] text-red-600 dark:text-red-400">{f.statusMessage}</p>
                        )}
                        {(f.enterpriseName || f.reportPeriod) && (
                          <p className="text-[10px] text-muted-foreground">
                            {f.enterpriseName && <span className="font-medium">{f.enterpriseName}</span>}
                            {f.enterpriseName && f.reportPeriod && <span> · </span>}
                            {f.reportPeriod && <span>{f.reportPeriod}</span>}
                          </p>
                        )}
                      </div>
                    </div>
                    <ConfirmDestructiveDialog
                      trigger={
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                          disabled={deleteGlFileMutation.isPending || isActive}
                          data-testid={`button-delete-gl-file-${f.id}`}
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      }
                      title={`Delete "${f.originalName}"?`}
                      description="This will permanently remove this file and all its transactions and reconciliation data."
                      confirmWord="DELETE"
                      onConfirm={() => deleteGlFileMutation.mutate(f.id)}
                      isPending={deleteGlFileMutation.isPending}
                    />
                  </div>
                  );
                })}

                {hasUnprocessed && (
                  <div className="pt-2 border-t">
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-muted-foreground">
                        {activeCount > 0 && `${activeCount} file(s) active`}
                        {activeCount > 0 && readyToProcessCount > 0 && ", "}
                        {readyToProcessCount > 0 && `${readyToProcessCount} file(s) ready to process`}
                        {activeCount === 0 && readyToProcessCount === 0 && `${unprocessedCount} file(s) pending`}
                      </p>
                      <Button
                        size="sm"
                        disabled={processGlMutation.isPending || !hasMappings || readyToProcessCount === 0 || activeCount > 0}
                        onClick={() => processGlMutation.mutate()}
                        data-testid="button-process-gl"
                      >
                        {processGlMutation.isPending || activeCount > 0 ? (
                          <Loader2 className="w-3 h-3 animate-spin mr-1" />
                        ) : (
                          <Play className="w-3 h-3 mr-1" />
                        )}
                        {activeCount > 0 ? "Working..." : processGlMutation.isPending ? "Queued..." : "Process"}
                      </Button>
                    </div>
                    {!hasMappings && readyToProcessCount > 0 && (
                      <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                        Upload the mapping file first before processing GL files.
                      </p>
                    )}
                  </div>
                )}
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
                  <ConfirmDestructiveDialog
                    trigger={
                      <Button variant="outline" size="sm" data-testid="button-clear-mapping">
                        <Trash2 className="w-3 h-3 mr-1" /> Clear
                      </Button>
                    }
                    title="Clear Mapping Data"
                    description="This will permanently delete all GL mapping and Company Code mapping data. This mapping is shared with the IC Matrix module. This action cannot be undone."
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

    </div>
  );
}
