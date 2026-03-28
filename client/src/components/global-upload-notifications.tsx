import { useUploadManager, type UploadNotification } from "@/lib/upload-manager";
import { Progress } from "@/components/ui/progress";
import { X, CheckCircle, AlertCircle, Loader2, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";

function NotificationItem({ n, onDismiss }: { n: UploadNotification; onDismiss: () => void }) {
  const bgColor =
    n.status === "success" ? "bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800" :
    n.status === "error" ? "bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800" :
    "bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800";

  const icon =
    n.status === "success" ? <CheckCircle className="h-4 w-4 text-green-600 shrink-0" /> :
    n.status === "error" ? <AlertCircle className="h-4 w-4 text-red-600 shrink-0" /> :
    n.status === "processing" ? <Loader2 className="h-4 w-4 text-blue-600 animate-spin shrink-0" /> :
    <Upload className="h-4 w-4 text-blue-600 shrink-0" />;

  const moduleLabel = n.module === "recon" ? "IC Recon" : "IC Matrix";
  const statusLabel =
    n.status === "uploading" ? "Uploading" :
    n.status === "processing" ? "Processing" :
    n.status === "success" ? "Complete" : "Failed";

  return (
    <div className={`rounded-lg border p-3 shadow-lg ${bgColor}`} data-testid={`notification-upload-${n.id}`}>
      <div className="flex items-start gap-2">
        {icon}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-muted/60 text-muted-foreground shrink-0">{moduleLabel}</span>
              <span className="text-xs font-medium truncate">{n.label}</span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0 ml-2">
              {(n.status === "uploading" || n.status === "processing") && (
                <span className="text-xs font-bold text-blue-700 dark:text-blue-300">{n.progress}%</span>
              )}
              <Badge
                variant="outline"
                className={`text-[10px] px-1.5 py-0 h-4 ${
                  n.status === "success" ? "border-green-400 text-green-700 dark:text-green-300" :
                  n.status === "error" ? "border-red-400 text-red-700 dark:text-red-300" :
                  "border-blue-400 text-blue-700 dark:text-blue-300"
                }`}
              >
                {statusLabel}
              </Badge>
              {(n.status === "success" || n.status === "error") && (
                <button onClick={onDismiss} className="shrink-0 text-muted-foreground hover:text-foreground" data-testid={`button-dismiss-notification-${n.id}`}>
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
          {(n.status === "uploading" || n.status === "processing") && (
            <Progress
              value={n.status === "processing" ? 100 : n.progress}
              className={`h-2 mb-1 ${
                n.status === "processing"
                  ? "[&>div]:bg-blue-400 [&>div]:animate-pulse"
                  : "[&>div]:bg-blue-500"
              }`}
            />
          )}
          <p className="text-xs text-muted-foreground truncate">{n.message}</p>
        </div>
      </div>
    </div>
  );
}

export default function GlobalUploadNotifications() {
  const { notifications, removeNotification } = useUploadManager();

  if (notifications.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 w-96" data-testid="container-global-upload-notifications">
      {notifications.map(n => (
        <NotificationItem key={n.id} n={n} onDismiss={() => removeNotification(n.id)} />
      ))}
    </div>
  );
}
