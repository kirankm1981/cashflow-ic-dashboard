import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { queryClient } from "./queryClient";

type UploadStatus = "idle" | "uploading" | "processing" | "success" | "error";

export interface UploadNotification {
  id: string;
  module: "recon" | "ic-matrix" | "cashflow";
  label: string;
  progress: number;
  status: UploadStatus;
  message: string;
}

interface UploadManagerContextType {
  notifications: UploadNotification[];
  addNotification: (n: UploadNotification) => void;
  updateNotification: (id: string, updates: Partial<UploadNotification>) => void;
  removeNotification: (id: string) => void;
  uploadWithProgress: (url: string, formData: FormData, onProgress: (pct: number) => void) => Promise<any>;
  uploadGlFile: (file: File, label: string, slotId: string) => Promise<void>;
  uploadMappingFile: (file: File) => Promise<void>;
  uploadTbFile: (file: File, label: string, slotId: string, periodStart?: string, periodEnd?: string) => Promise<void>;
  uploadCashflowTb: (file: File, label: string, slotId: string) => Promise<void>;
  uploadCashflowMapping: (file: File) => Promise<void>;
  isUploading: (module: "recon" | "ic-matrix" | "cashflow") => boolean;
}

const UploadManagerContext = createContext<UploadManagerContextType | null>(null);

function formatNum(val: number | null | undefined): string {
  if (val === null || val === undefined) return "0";
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(val);
}

function xhrUpload(url: string, formData: FormData, onProgress: (pct: number) => void): Promise<any> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.timeout = 600000;
    xhr.open("POST", url);
    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    });
    xhr.addEventListener("load", () => {
      try {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(data);
        } else {
          reject(new Error(data.message || "Upload failed"));
        }
      } catch {
        reject(new Error("Invalid response"));
      }
    });
    xhr.addEventListener("timeout", () => reject(new Error("Upload timed out — the file may be too large. Try splitting it into smaller files.")));
    xhr.addEventListener("error", () => reject(new Error("Network error")));
    xhr.addEventListener("abort", () => reject(new Error("Upload cancelled")));
    xhr.send(formData);
  });
}

export function UploadManagerProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<UploadNotification[]>([]);

  const addNotification = useCallback((n: UploadNotification) => {
    setNotifications(prev => [...prev.filter(p => p.id !== n.id), n]);
  }, []);

  const updateNotification = useCallback((id: string, updates: Partial<UploadNotification>) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, ...updates } : n));
  }, []);

  const removeNotification = useCallback((id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  const uploadWithProgress = useCallback(xhrUpload, []);

  const uploadGlFile = useCallback(async (file: File, label: string, slotId: string) => {
    const notifId = `recon-gl-${slotId}-${Date.now()}`;
    addNotification({ id: notifId, module: "recon", label, progress: 0, status: "uploading", message: "Uploading file..." });

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("label", label);

      const data = await xhrUpload("/api/recon/upload-gl", formData, (pct) => {
        updateNotification(notifId, {
          progress: pct,
          message: pct < 100 ? `Uploading file... ${pct}%` : "Processing GL data...",
          status: pct < 100 ? "uploading" : "processing",
        });
      });

      updateNotification(notifId, {
        progress: 100,
        status: "success",
        message: `${data.fileName} — ${formatNum(data.icRecords)} IC records from ${formatNum(data.totalTransactions)} transactions`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/recon/gl-files"] });
      queryClient.invalidateQueries({ queryKey: ["/api/upload-batches"] });
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/counterparties"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company-pairs"] });
      setTimeout(() => removeNotification(notifId), 8000);
    } catch (err: any) {
      updateNotification(notifId, { progress: 100, status: "error", message: err.message || "Upload failed" });
    }
  }, [addNotification, updateNotification, removeNotification]);

  const uploadMappingFile = useCallback(async (file: File) => {
    const notifId = `mapping-${Date.now()}`;
    addNotification({ id: notifId, module: "recon", label: "IC Mapping File", progress: 0, status: "uploading", message: "Uploading mapping file..." });

    try {
      const formData = new FormData();
      formData.append("file", file);

      const data = await xhrUpload("/api/ic-matrix/upload-mapping", formData, (pct) => {
        updateNotification(notifId, {
          progress: pct,
          message: pct < 100 ? `Uploading file... ${pct}%` : "Processing mappings...",
          status: pct < 100 ? "uploading" : "processing",
        });
      });

      updateNotification(notifId, {
        progress: 100,
        status: "success",
        message: `GL Mappings: ${data.glMappings}, Company Codes: ${data.companyMappings}`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/recon/mapping-status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ic-matrix/mapping-summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ic-matrix/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ic-matrix/dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ic-matrix/tb-data"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/summarized-lines"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company-pairs"] });
      setTimeout(() => removeNotification(notifId), 8000);
    } catch (err: any) {
      updateNotification(notifId, { progress: 100, status: "error", message: err.message || "Upload failed" });
    }
  }, [addNotification, updateNotification, removeNotification]);

  const uploadTbFile = useCallback(async (file: File, label: string, slotId: string, periodStart?: string, periodEnd?: string) => {
    const notifId = `ic-matrix-tb-${slotId}-${Date.now()}`;
    addNotification({ id: notifId, module: "ic-matrix", label, progress: 0, status: "uploading", message: "Uploading file..." });

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("label", label);
      if (periodStart) formData.append("periodStart", periodStart);
      if (periodEnd) formData.append("periodEnd", periodEnd);

      const data = await xhrUpload("/api/ic-matrix/upload-tb", formData, (pct) => {
        updateNotification(notifId, {
          progress: pct,
          message: pct < 100 ? `Uploading file... ${pct}%` : "Processing data on server...",
          status: pct < 100 ? "uploading" : "processing",
        });
      });

      updateNotification(notifId, {
        progress: 100,
        status: "success",
        message: `${data.fileName} — ${formatNum(data.recordsInserted)} records loaded`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/ic-matrix/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ic-matrix/tb-files"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ic-matrix/tb-data"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ic-matrix/dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ic-matrix/mapping-summary"] });
      setTimeout(() => removeNotification(notifId), 8000);
    } catch (err: any) {
      updateNotification(notifId, { progress: 100, status: "error", message: err.message || "Upload failed" });
    }
  }, [addNotification, updateNotification, removeNotification]);

  const uploadCashflowTb = useCallback(async (file: File, label: string, slotId: string) => {
    const notifId = `cashflow-tb-${slotId}-${Date.now()}`;
    addNotification({ id: notifId, module: "cashflow", label, progress: 0, status: "uploading", message: "Uploading file..." });

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("label", label);

      const data = await xhrUpload("/api/cashflow/upload-tb", formData, (pct) => {
        updateNotification(notifId, {
          progress: pct,
          message: pct < 100 ? `Uploading file... ${pct}%` : "Processing TB data...",
          status: pct < 100 ? "uploading" : "processing",
        });
      });

      updateNotification(notifId, {
        progress: 100,
        status: "success",
        message: `${data.enterprise || label} — ${formatNum(data.totalRecords)} records loaded`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/cashflow/tb-files"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cashflow/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cashflow/compiled-data"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cashflow/unified-data"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cashflow/unmapped-items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cashflow/past-losses"] });
      setTimeout(() => removeNotification(notifId), 8000);
    } catch (err: any) {
      updateNotification(notifId, { progress: 100, status: "error", message: err.message || "Upload failed" });
    }
  }, [addNotification, updateNotification, removeNotification]);

  const uploadCashflowMapping = useCallback(async (file: File) => {
    const notifId = `cashflow-mapping-${Date.now()}`;
    addNotification({ id: notifId, module: "cashflow", label: "Cashflow Mapping", progress: 0, status: "uploading", message: "Uploading mapping file..." });

    try {
      const formData = new FormData();
      formData.append("file", file);

      const data = await xhrUpload("/api/cashflow/upload-mapping", formData, (pct) => {
        updateNotification(notifId, {
          progress: pct,
          message: pct < 100 ? `Uploading file... ${pct}%` : "Processing mappings...",
          status: pct < 100 ? "uploading" : "processing",
        });
      });

      updateNotification(notifId, {
        progress: 100,
        status: "success",
        message: `Groupings: ${data.groupingsInserted}, Entities: ${data.entitiesInserted}, Past Losses: ${data.pastLossesInserted}`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/cashflow/mapping-summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cashflow/past-losses"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cashflow/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cashflow/compiled-data"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cashflow/unified-data"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cashflow/unmapped-items"] });
      setTimeout(() => removeNotification(notifId), 8000);
    } catch (err: any) {
      updateNotification(notifId, { progress: 100, status: "error", message: err.message || "Upload failed" });
    }
  }, [addNotification, updateNotification, removeNotification]);

  const isUploading = useCallback((module: "recon" | "ic-matrix" | "cashflow") => {
    return notifications.some(n => n.module === module && (n.status === "uploading" || n.status === "processing"));
  }, [notifications]);

  return (
    <UploadManagerContext.Provider value={{
      notifications,
      addNotification,
      updateNotification,
      removeNotification,
      uploadWithProgress: xhrUpload,
      uploadGlFile,
      uploadMappingFile,
      uploadTbFile,
      uploadCashflowTb,
      uploadCashflowMapping,
      isUploading,
    }}>
      {children}
    </UploadManagerContext.Provider>
  );
}

export function useUploadManager() {
  const ctx = useContext(UploadManagerContext);
  if (!ctx) throw new Error("useUploadManager must be used within UploadManagerProvider");
  return ctx;
}
