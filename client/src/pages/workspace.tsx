import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import {
  GitCompare,
  Loader2,
  FileSpreadsheet,
  ArrowLeftRight,
  Search,
  RotateCcw,
  Link2,
  Unlink2,
  X,
  ChevronsUpDown,
  Download,
  Upload,
} from "lucide-react";
import type { SummarizedLine } from "@shared/schema";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";

interface CompanyPair {
  company: string;
  counterParty: string;
  total: number;
  matched: number;
  unmatched: number;
  totalDebit: number;
  totalCredit: number;
}

function parseDocDate(dateStr: string | null): Date | null {
  if (!dateStr) return null;
  const num = parseFloat(dateStr);
  if (!isNaN(num) && num > 40000 && num < 60000) {
    const epoch = new Date(1899, 11, 30);
    epoch.setDate(epoch.getDate() + num);
    return epoch;
  }
  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) return d;
  return null;
}

function formatDate(dateStr: string | null): string {
  const d = parseDocDate(dateStr);
  if (!d) return dateStr || "-";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

function formatAmount(val: number | null): string {
  if (val === null || val === undefined) return "-";
  if (val === 0) return "0.00";
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(val));
}

function StatusPill({ status }: { status: string }) {
  const configs: Record<string, { label: string; bg: string; dot: string; testId: string }> = {
    matched: { label: "AUTO MATCH", bg: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400", dot: "bg-emerald-500", testId: "status-matched" },
    reversal: { label: "REVERSAL", bg: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400", dot: "bg-purple-500", testId: "status-reversal" },
    review_match: { label: "REVIEW", bg: "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400", dot: "bg-teal-500", testId: "status-review-match" },
    suggested_match: { label: "SUGGESTED", bg: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400", dot: "bg-orange-500", testId: "status-suggested-match" },
    probable: { label: "PROBABLE", bg: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400", dot: "bg-amber-500", testId: "status-probable" },
    manual: { label: "MANUAL", bg: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400", dot: "bg-blue-500", testId: "status-manual" },
  };
  const cat = getStatusFromReconStatus(status);
  const cfg = configs[cat] || { label: "UNMATCHED", bg: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400", dot: "bg-red-500", testId: "status-unmatched" };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${cfg.bg}`} data-testid={cfg.testId}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

function getStatusFromReconStatus(status: string): string {
  if (status === "matched") return "matched";
  if (status === "reversal") return "reversal";
  if (status === "review_match") return "review_match";
  if (status === "suggested_match") return "suggested_match";
  if (status === "probable") return "probable";
  if (status === "manual") return "manual";
  return "unmatched";
}

function getStatusCategory(line: SummarizedLine): string {
  const s = line.reconStatus || "unmatched";
  if (s === "matched") {
    const rule = line.reconRule?.toLowerCase() || "";
    if (rule.includes("manual")) return "manual";
    return "matched";
  }
  return getStatusFromReconStatus(s);
}

type StatusFilter = "all" | "matched" | "reversal" | "review_match" | "suggested_match" | "unmatched";

function EntityPanel({
  entityName,
  lines,
  searchQuery,
  isPartyA,
  selectedIds,
  onToggleSelect,
  onSelectAll,
  selectionMode,
  statusFilter,
  onReconIdClick,
}: {
  entityName: string;
  lines: SummarizedLine[];
  searchQuery: string;
  isPartyA: boolean;
  selectedIds: Set<number>;
  onToggleSelect: (id: number) => void;
  onSelectAll: (ids: number[], checked: boolean) => void;
  selectionMode: boolean;
  statusFilter: StatusFilter;
  onReconIdClick: (reconId: string) => void;
}) {
  const filtered = useMemo(() => {
    let result = lines;
    if (statusFilter !== "all") {
      result = result.filter((t) => {
        const cat = getStatusCategory(t);
        if (statusFilter === "matched") return cat === "matched" || cat === "manual";
        if (statusFilter === "review_match") return cat === "review_match";
        if (statusFilter === "suggested_match") return cat === "suggested_match";
        return cat === statusFilter;
      });
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (t) =>
          (t.documentNo || "").toLowerCase().includes(q) ||
          (t.narration || "").toLowerCase().includes(q) ||
          formatAmount(t.netAmount).includes(q)
      );
    }
    result = [...result].sort((a, b) => {
      const cpA = (a.counterParty || "").localeCompare(b.counterParty || "");
      if (cpA !== 0) return cpA;
      const da = parseDocDate(a.docDate);
      const db2 = parseDocDate(b.docDate);
      if (!da && !db2) return 0;
      if (!da) return 1;
      if (!db2) return -1;
      return da.getTime() - db2.getTime();
    });
    return result;
  }, [lines, searchQuery, statusFilter]);

  const unmatchedFiltered = filtered.filter((t) => getStatusCategory(t) === "unmatched");
  const recCount = filtered.filter((t) => getStatusCategory(t) === "matched").length;
  const reversalCount = filtered.filter((t) => getStatusCategory(t) === "reversal").length;
  const reviewCount = filtered.filter((t) => getStatusCategory(t) === "review_match").length;
  const suggestedCount = filtered.filter((t) => getStatusCategory(t) === "suggested_match").length;
  const manualCount = filtered.filter((t) => getStatusCategory(t) === "manual").length;
  const unrecCount = filtered.filter((t) => getStatusCategory(t) === "unmatched").length;

  const allUnmatchedIds = unmatchedFiltered.map((t) => t.id);
  const allUnmatchedSelected = allUnmatchedIds.length > 0 && allUnmatchedIds.every((id) => selectedIds.has(id));

  return (
    <div className={`flex-1 min-w-0 border rounded-lg overflow-hidden ${selectionMode ? "border-primary/50" : ""}`} data-testid={`panel-${isPartyA ? "entity-a" : "entity-b"}`}>
      <div className="bg-muted/40 px-4 py-3 border-b flex items-center justify-between">
        <h3 className="text-sm font-bold uppercase tracking-wide truncate" data-testid={`text-entity-${isPartyA ? "a" : "b"}-name`}>
          {entityName}
        </h3>
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <span className="inline-flex items-center gap-1 text-xs">
            <span className="font-bold text-emerald-600">{recCount}</span>
            <span className="text-muted-foreground">Auto</span>
          </span>
          {reversalCount > 0 && (
            <span className="inline-flex items-center gap-1 text-xs">
              <span className="font-bold text-purple-600">{reversalCount}</span>
              <span className="text-muted-foreground">Rev</span>
            </span>
          )}
          {reviewCount > 0 && (
            <span className="inline-flex items-center gap-1 text-xs">
              <span className="font-bold text-teal-600">{reviewCount}</span>
              <span className="text-muted-foreground">Review</span>
            </span>
          )}
          {suggestedCount > 0 && (
            <span className="inline-flex items-center gap-1 text-xs">
              <span className="font-bold text-orange-600">{suggestedCount}</span>
              <span className="text-muted-foreground">Sugg</span>
            </span>
          )}
          {manualCount > 0 && (
            <span className="inline-flex items-center gap-1 text-xs">
              <span className="font-bold text-blue-600">{manualCount}</span>
              <span className="text-muted-foreground">Man</span>
            </span>
          )}
          <span className="inline-flex items-center gap-1 text-xs">
            <span className="font-bold text-red-600">{unrecCount}</span>
            <span className="text-muted-foreground">Unrec</span>
          </span>
        </div>
      </div>

      <ScrollArea className="max-h-[60vh]" type="always">
        <table className="w-full text-sm" data-testid={`table-${isPartyA ? "party-a" : "party-b"}`}>
          <thead className="sticky top-0 bg-card z-10">
            <tr className="border-b">
              {selectionMode && (
                <th className="w-10 py-2.5 px-2 text-center">
                  <Checkbox
                    checked={allUnmatchedSelected}
                    onCheckedChange={(checked) => onSelectAll(allUnmatchedIds, !!checked)}
                    data-testid={`checkbox-select-all-${isPartyA ? "a" : "b"}`}
                  />
                </th>
              )}
              <th className="text-left py-2.5 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Counter Party</th>
              <th className="text-left py-2.5 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Date</th>
              <th className="text-left py-2.5 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Document No</th>
              <th className="text-right py-2.5 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Net Amount</th>
              <th className="text-center py-2.5 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Status</th>
              <th className="text-left py-2.5 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Match Rule</th>
              <th className="text-left py-2.5 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Rec ID</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={selectionMode ? 8 : 7} className="py-12 text-center text-sm text-muted-foreground">
                  No lines found
                </td>
              </tr>
            ) : (
              filtered.map((line) => {
                const amt = line.netAmount || 0;
                const statusCat = getStatusCategory(line);
                const refText = line.documentNo || "";
                const narText = line.narration || "";
                const displayRef = refText || narText.slice(0, 30) || "-";
                const isUnmatched = getStatusCategory(line) === "unmatched";
                const isSelected = selectedIds.has(line.id);

                return (
                  <tr
                    key={line.id}
                    className={`border-b last:border-0 transition-colors ${
                      isSelected
                        ? "bg-blue-100 dark:bg-blue-900/40"
                        : "hover:bg-muted/20"
                    } ${selectionMode && isUnmatched ? "cursor-pointer" : ""}`}
                    onClick={selectionMode && isUnmatched ? () => onToggleSelect(line.id) : undefined}
                    data-testid={`row-line-${line.id}`}
                  >
                    {selectionMode && (
                      <td className={`w-10 py-2.5 px-2 text-center ${isSelected ? "border-l-2 border-l-blue-500" : ""}`} onClick={(e) => e.stopPropagation()}>
                        {isUnmatched ? (
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => onToggleSelect(line.id)}
                            data-testid={`checkbox-line-${line.id}`}
                          />
                        ) : null}
                      </td>
                    )}
                    <td className={`py-2.5 px-3 text-xs max-w-[120px] truncate ${!selectionMode && isSelected ? "border-l-2 border-l-blue-500" : ""}`} title={line.counterParty}>
                      {line.counterParty}
                    </td>
                    <td className="py-2.5 px-3 text-xs whitespace-nowrap font-mono">
                      {formatDate(line.docDate)}
                    </td>
                    <td className="py-2.5 px-3 text-xs max-w-[180px]">
                      <div className="truncate font-medium" title={refText}>
                        {displayRef}
                      </div>
                    </td>
                    <td className={`py-2.5 px-3 text-right text-xs font-mono font-medium whitespace-nowrap ${amt < 0 ? "text-red-600" : "text-emerald-600"}`}>
                      {amt < 0 ? `(${formatAmount(amt)})` : formatAmount(amt)}
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      <StatusPill status={statusCat} />
                    </td>
                    <td className="py-2.5 px-3 text-xs text-muted-foreground max-w-[140px] truncate" title={line.reconRule || ""}>
                      {line.reconRule || "-"}
                    </td>
                    <td className="py-2.5 px-3 text-xs font-mono max-w-[100px] truncate">
                      {line.reconId ? (
                        <button
                          className="text-primary hover:underline cursor-pointer"
                          onClick={(e) => { e.stopPropagation(); onReconIdClick(line.reconId!); }}
                          data-testid={`link-recon-${line.reconId}`}
                        >
                          {line.reconId}
                        </button>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
    </div>
  );
}

function ReconGroupDialog({
  reconId,
  open,
  onOpenChange,
}: {
  reconId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const { data: groupLines, isLoading } = useQuery<SummarizedLine[]>({
    queryKey: ["/api/summarized-lines", "reconId", reconId],
    queryFn: async () => {
      const res = await fetch(`/api/summarized-lines?reconId=${encodeURIComponent(reconId!)}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!reconId && open,
  });

  const unmatchMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/unmatch", { reconId });
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({
        title: "Unmatched Successfully",
        description: `${data.unmatched} transactions returned to unmatched status (${reconId})`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/summarized-lines"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company-pairs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recon-groups"] });
      onOpenChange(false);
    },
    onError: (error: any) => {
      toast({
        title: "Unmatch Failed",
        description: error.message || "Failed to unmatch transactions",
        variant: "destructive",
      });
    },
  });

  const companies = useMemo(() => {
    if (!groupLines) return [];
    return [...new Set(groupLines.map((l) => l.company))];
  }, [groupLines]);

  const ruleName = groupLines?.[0]?.reconRule || "-";
  const status = groupLines?.[0]?.reconStatus || "-";

  const totalDebit = (groupLines || []).filter(l => (l.netAmount || 0) > 0).reduce((s, l) => s + (l.netAmount || 0), 0);
  const totalCredit = (groupLines || []).filter(l => (l.netAmount || 0) < 0).reduce((s, l) => s + Math.abs(l.netAmount || 0), 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden flex flex-col" data-testid="dialog-recon-group">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <span data-testid="text-recon-dialog-id">{reconId}</span>
            <Badge variant="secondary" data-testid="text-recon-dialog-rule">{ruleName}</Badge>
            <StatusPill status={status} />
          </DialogTitle>
          <DialogDescription className="flex items-center justify-between">
            <span>Matched transactions from both sides of the reconciliation group</span>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => unmatchMutation.mutate()}
              disabled={unmatchMutation.isPending}
              data-testid="button-unmatch"
            >
              {unmatchMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
              ) : (
                <Unlink2 className="w-4 h-4 mr-1.5" />
              )}
              Unmatch
            </Button>
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-4 text-sm mb-2">
          <span>Total Debit: <span className="font-semibold text-emerald-600">{formatAmount(totalDebit)}</span></span>
          <span>Total Credit: <span className="font-semibold text-red-600">({formatAmount(-totalCredit)})</span></span>
          <span>Difference: <span className="font-semibold">{formatAmount(totalDebit - totalCredit)}</span></span>
        </div>
        <ScrollArea className="flex-1 min-h-0" type="always">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-4">
              {companies.map((company) => {
                const companyLines = (groupLines || [])
                  .filter((l) => l.company === company)
                  .sort((a, b) => {
                    const da = parseDocDate(a.docDate);
                    const db2 = parseDocDate(b.docDate);
                    if (!da && !db2) return 0;
                    if (!da) return 1;
                    if (!db2) return -1;
                    return da.getTime() - db2.getTime();
                  });
                return (
                  <div key={company}>
                    <h4 className="text-sm font-bold mb-2 px-1">{company}</h4>
                    <table className="w-full text-sm border rounded">
                      <thead>
                        <tr className="border-b bg-muted/40">
                          <th className="text-left py-2 px-3 text-xs font-semibold text-muted-foreground">Date</th>
                          <th className="text-left py-2 px-3 text-xs font-semibold text-muted-foreground">Counter Party</th>
                          <th className="text-left py-2 px-3 text-xs font-semibold text-muted-foreground">Document No</th>
                          <th className="text-right py-2 px-3 text-xs font-semibold text-muted-foreground">Net Amount</th>
                          <th className="text-left py-2 px-3 text-xs font-semibold text-muted-foreground">Narration</th>
                        </tr>
                      </thead>
                      <tbody>
                        {companyLines.map((line) => {
                          const amt = line.netAmount || 0;
                          return (
                            <tr key={line.id} className="border-b last:border-0" data-testid={`dialog-row-${line.id}`}>
                              <td className="py-2 px-3 text-xs font-mono whitespace-nowrap">{formatDate(line.docDate)}</td>
                              <td className="py-2 px-3 text-xs max-w-[160px] truncate" title={line.counterParty}>{line.counterParty}</td>
                              <td className="py-2 px-3 text-xs font-medium">{line.documentNo || "-"}</td>
                              <td className={`py-2 px-3 text-right text-xs font-mono font-medium whitespace-nowrap ${amt < 0 ? "text-red-600" : "text-emerald-600"}`}>
                                {amt < 0 ? `(${formatAmount(amt)})` : formatAmount(amt)}
                              </td>
                              <td className="py-2 px-3 text-xs max-w-[200px] truncate text-muted-foreground" title={line.narration || ""}>{line.narration || "-"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                );
              })}
            </div>
          )}
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

export default function Workspace({ embedded = false }: { embedded?: boolean } = {}) {
  const { toast } = useToast();
  const [entityAList, setEntityAList] = useState<string[]>([]);
  const [entityBList, setEntityBList] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<string>("grid");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [selectedReconId, setSelectedReconId] = useState<string | null>(null);
  const [entityAPopoverOpen, setEntityAPopoverOpen] = useState(false);
  const [entityBPopoverOpen, setEntityBPopoverOpen] = useState(false);

  const { data: companyPairs, isLoading: pairsLoading } = useQuery<CompanyPair[]>({
    queryKey: ["/api/company-pairs"],
  });
  const { data: nameMap } = useQuery<Record<string, string>>({
    queryKey: ["/api/company-name-map"],
  });
  const displayName = (code: string) => (nameMap && nameMap[code]) ? `${nameMap[code]} (${code})` : code;

  const uniqueCompanies = useMemo(() => {
    return Array.from(
      new Set(companyPairs?.flatMap((p) => [p.company, p.counterParty]) || [])
    ).filter((c) => c && c.trim()).sort();
  }, [companyPairs]);

  const counterPartyOptions = useMemo(() => {
    const aSet = new Set(entityAList);
    return uniqueCompanies.filter((c) => !aSet.has(c));
  }, [uniqueCompanies, entityAList]);

  const entityAOptions = useMemo(() => {
    const bSet = new Set(entityBList);
    return uniqueCompanies.filter((c) => !bSet.has(c));
  }, [uniqueCompanies, entityBList]);

  const hasPairSelected = entityAList.length > 0 && entityBList.length > 0;

  const entityAJoined = entityAList.join(",");
  const entityBJoined = entityBList.join(",");

  const { data: linesA, isLoading: loadingA } = useQuery<SummarizedLine[]>({
    queryKey: ["/api/summarized-lines", "partyA", entityAJoined],
    queryFn: async () => {
      const res = await fetch(`/api/summarized-lines?companies=${encodeURIComponent(entityAJoined)}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!hasPairSelected,
  });

  const { data: linesB, isLoading: loadingB } = useQuery<SummarizedLine[]>({
    queryKey: ["/api/summarized-lines", "partyB", entityBJoined],
    queryFn: async () => {
      const res = await fetch(`/api/summarized-lines?companies=${encodeURIComponent(entityBJoined)}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!hasPairSelected,
  });

  const reconcileMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/reconcile");
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Reconciliation Complete",
        description: `${data.totalMatched} lines matched across ${data.ruleResults.length} rules`,
      });
      queryClient.invalidateQueries();
    },
    onError: (error: Error) => {
      toast({ title: "Reconciliation Failed", description: error.message, variant: "destructive" });
    },
  });


  const manualMatchMutation = useMutation({
    mutationFn: async (transactionIds: number[]) => {
      const res = await apiRequest("POST", "/api/manual-reconcile", { transactionIds });
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Manual Match Complete",
        description: `${data.matched} transactions manually reconciled (ID: ${data.reconId})`,
      });
      setSelectedIds(new Set());
      setSelectionMode(false);
      queryClient.invalidateQueries();
    },
    onError: (error: Error) => {
      toast({ title: "Manual Match Failed", description: error.message, variant: "destructive" });
    },
  });

  const handleToggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSelectAll = (ids: number[], checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) ids.forEach((id) => next.add(id));
      else ids.forEach((id) => next.delete(id));
      return next;
    });
  };

  const handleManualMatch = () => {
    if (!hasBothSides) {
      toast({ title: "Select from both entities", description: "You must select at least one transaction from each entity grid to create a manual match", variant: "destructive" });
      return;
    }
    if (!amountsMatch) {
      toast({ title: "Amounts do not match", description: `Total debits (${formatAmount(totalPositive)}) must equal total credits (${formatAmount(totalNegative)}) to create a manual match`, variant: "destructive" });
      return;
    }
    const ids = Array.from(selectedIds);
    manualMatchMutation.mutate(ids);
  };

  const handleCancelSelection = () => {
    setSelectedIds(new Set());
    setSelectionMode(false);
  };

  const handleReset = () => {
    setEntityAList([]);
    setEntityBList([]);
    setSearchQuery("");
    setActiveTab("grid");
    setSelectedIds(new Set());
    setSelectionMode(false);
    setStatusFilter("all");
  };

  const handleSwapEntities = () => {
    const tempA = [...entityAList];
    setEntityAList([...entityBList]);
    setEntityBList(tempA);
  };

  const handleExportExcel = () => {
    if (!hasPairSelected) return;
    const allCompanies = [...new Set([...entityAList, ...entityBList])].join(",");
    const params = new URLSearchParams();
    params.set("companies", allCompanies);
    const link = document.createElement("a");
    link.href = `/api/export/excel?${params.toString()}`;
    link.click();
  };

  const handleDownloadTemplate = () => {
    const params = new URLSearchParams();
    if (entityAJoined) params.set("companies", entityAJoined);
    if (entityBJoined) params.set("counterParty", entityBJoined);
    if (statusFilter !== "all") {
      const statusMap: Record<string, string> = {
        matched: "matched", reversal: "reversal", review: "review_match",
        suggested: "suggested_match", unmatched: "unmatched",
      };
      if (statusMap[statusFilter]) params.set("reconStatus", statusMap[statusFilter]);
    }
    const link = document.createElement("a");
    link.href = `/api/export/reconciliation-template?${params.toString()}`;
    link.click();
  };

  const uploadReconciliationMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload/reconciliation", { method: "POST", body: formData });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Upload failed");
      }
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({
        title: "Upload Successful",
        description: data.message,
      });
      if (data.errors && data.errors.length > 0) {
        toast({
          title: "Some groups had issues",
          description: data.errors.join("; "),
          variant: "destructive",
        });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/summarized-lines"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company-pairs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recon-groups"] });
    },
    onError: (error: any) => {
      toast({
        title: "Upload Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleUploadReconciliation = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".xlsx,.xls";
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) uploadReconciliationMutation.mutate(file);
    };
    input.click();
  };

  const overviewPairs = useMemo(() => {
    if (!companyPairs) return [];
    const aSet = new Set(entityAList);
    const bSet = new Set(entityBList);
    if (aSet.size > 0 && bSet.size === 0) {
      return companyPairs.filter((p) => aSet.has(p.company) || aSet.has(p.counterParty));
    }
    if (aSet.size > 0 && bSet.size > 0) {
      return companyPairs.filter(
        (p) =>
          (aSet.has(p.company) && bSet.has(p.counterParty)) ||
          (bSet.has(p.company) && aSet.has(p.counterParty))
      );
    }
    if (aSet.size === 0 && bSet.size > 0) {
      return companyPairs.filter((p) => bSet.has(p.company) || bSet.has(p.counterParty));
    }
    return companyPairs;
  }, [companyPairs, entityAList, entityBList]);

  const selectedFromA = linesA?.filter((t) => selectedIds.has(t.id)) || [];
  const selectedFromB = linesB?.filter((t) => selectedIds.has(t.id)) || [];
  const totalSelected = selectedIds.size;
  const selectedPositiveA = selectedFromA.reduce((s, t) => s + Math.max(t.netAmount || 0, 0), 0);
  const selectedNegativeA = selectedFromA.reduce((s, t) => s + Math.min(t.netAmount || 0, 0), 0);
  const selectedPositiveB = selectedFromB.reduce((s, t) => s + Math.max(t.netAmount || 0, 0), 0);
  const selectedNegativeB = selectedFromB.reduce((s, t) => s + Math.min(t.netAmount || 0, 0), 0);

  const totalPositive = selectedPositiveA + selectedPositiveB;
  const totalNegative = Math.abs(selectedNegativeA + selectedNegativeB);
  const amountsMatch = totalPositive > 0 && totalNegative > 0 && Math.abs(totalPositive - totalNegative) < 0.01;
  const hasBothSides = selectedFromA.length > 0 && selectedFromB.length > 0;

  return (
    <div className="p-4 space-y-4 h-full flex flex-col">
      {!embedded && <h1 className="text-xl font-bold" data-testid="text-page-title">Reconciliation Dashboard</h1>}

      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex-1 min-w-[200px]">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1 block">
                Entity A (Books)
              </label>
              <Popover open={entityAPopoverOpen} onOpenChange={setEntityAPopoverOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    className="w-full justify-between font-normal"
                    data-testid="select-entity-a"
                  >
                    <span className="truncate">
                      {entityAList.length === 0
                        ? "Select Entity A..."
                        : entityAList.length === 1
                        ? displayName(entityAList[0])
                        : `${entityAList.length} selected`}
                    </span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[300px] p-0" align="start">
                  <div className="p-2 border-b">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium text-muted-foreground">
                        {entityAList.length} of {entityAOptions.length} selected
                      </span>
                      <div className="flex gap-1">
                        <button
                          className="text-xs text-primary hover:underline"
                          onClick={() => setEntityAList([...entityAOptions])}
                          data-testid="button-select-all-a"
                        >
                          All
                        </button>
                        <span className="text-xs text-muted-foreground">/</span>
                        <button
                          className="text-xs text-primary hover:underline"
                          onClick={() => setEntityAList([])}
                          data-testid="button-clear-all-a"
                        >
                          None
                        </button>
                      </div>
                    </div>
                  </div>
                  <ScrollArea className="max-h-[250px]">
                    <div className="p-1">
                      {entityAOptions.map((c) => (
                        <label
                          key={c}
                          className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/50 cursor-pointer text-sm"
                          data-testid={`option-entity-a-${c}`}
                        >
                          <Checkbox
                            checked={entityAList.includes(c)}
                            onCheckedChange={(checked) => {
                              if (checked) {
                                setEntityAList((prev) => [...prev, c]);
                              } else {
                                setEntityAList((prev) => prev.filter((x) => x !== c));
                              }
                            }}
                          />
                          <span className="truncate">{displayName(c)}</span>
                        </label>
                      ))}
                    </div>
                  </ScrollArea>
                </PopoverContent>
              </Popover>
            </div>

            <button
              onClick={handleSwapEntities}
              className="mt-5 p-2 rounded-full border hover:bg-muted transition-colors"
              title="Swap entities"
              data-testid="button-swap-entities"
            >
              <ArrowLeftRight className="w-4 h-4 text-muted-foreground" />
            </button>

            <div className="flex-1 min-w-[200px]">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1 block">
                Entity B (Counter Party)
              </label>
              <Popover open={entityBPopoverOpen} onOpenChange={setEntityBPopoverOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    className="w-full justify-between font-normal"
                    data-testid="select-entity-b"
                  >
                    <span className="truncate">
                      {entityBList.length === 0
                        ? "Select Counter Parties..."
                        : entityBList.length === 1
                        ? displayName(entityBList[0])
                        : `${entityBList.length} selected`}
                    </span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[300px] p-0" align="start">
                  <div className="p-2 border-b">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium text-muted-foreground">
                        {entityBList.length} of {counterPartyOptions.length} selected
                      </span>
                      <div className="flex gap-1">
                        <button
                          className="text-xs text-primary hover:underline"
                          onClick={() => setEntityBList([...counterPartyOptions])}
                          data-testid="button-select-all-b"
                        >
                          All
                        </button>
                        <span className="text-xs text-muted-foreground">/</span>
                        <button
                          className="text-xs text-primary hover:underline"
                          onClick={() => setEntityBList([])}
                          data-testid="button-clear-all-b"
                        >
                          None
                        </button>
                      </div>
                    </div>
                  </div>
                  <ScrollArea className="max-h-[250px]">
                    <div className="p-1">
                      {counterPartyOptions.map((cp) => (
                        <label
                          key={cp}
                          className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/50 cursor-pointer text-sm"
                          data-testid={`option-entity-b-${cp}`}
                        >
                          <Checkbox
                            checked={entityBList.includes(cp)}
                            onCheckedChange={(checked) => {
                              if (checked) {
                                setEntityBList((prev) => [...prev, cp]);
                              } else {
                                setEntityBList((prev) => prev.filter((x) => x !== cp));
                              }
                            }}
                          />
                          <span className="truncate">{displayName(cp)}</span>
                        </label>
                      ))}
                    </div>
                  </ScrollArea>
                </PopoverContent>
              </Popover>
            </div>

            <div className="flex items-end gap-2 mt-5">
              <Button
                onClick={() => reconcileMutation.mutate()}
                disabled={reconcileMutation.isPending}
                data-testid="button-reconcile"
              >
                {reconcileMutation.isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <GitCompare className="w-4 h-4 mr-2" />
                )}
                Run Engine
              </Button>
              <Button variant="outline" onClick={handleReset} data-testid="button-reset">
                <RotateCcw className="w-4 h-4 mr-2" />
                Reset
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between gap-4">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="overview" data-testid="tab-overview">Overview</TabsTrigger>
            <TabsTrigger value="grid" data-testid="tab-grid">Reconciliation Grid</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex items-center gap-2">
          {activeTab === "grid" && hasPairSelected && (
            <div className="flex items-center rounded-md border p-0.5 gap-0.5" data-testid="filter-status">
              {([
                { key: "all", label: "All", active: "bg-muted text-foreground" },
                { key: "matched", label: "Matched", active: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400" },
                { key: "reversal", label: "Reversal", active: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-400" },
                { key: "review_match", label: "Review", active: "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-400" },
                { key: "suggested_match", label: "Suggested", active: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400" },
                { key: "unmatched", label: "Unmatched", active: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400" },
              ] as { key: StatusFilter; label: string; active: string }[]).map((f) => (
                <button
                  key={f.key}
                  onClick={() => setStatusFilter(f.key)}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                    statusFilter === f.key ? f.active : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  }`}
                  data-testid={`button-filter-${f.key}`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          )}
          {activeTab === "grid" && hasPairSelected && !selectionMode && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSelectionMode(true)}
              data-testid="button-start-manual-match"
            >
              <Link2 className="w-4 h-4 mr-2" />
              Manual Match
            </Button>
          )}
          {activeTab === "grid" && hasPairSelected && (
            <div className="relative">
              <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-muted-foreground" />
              <Input
                placeholder="Search amounts or refs..."
                className="pl-9 w-[220px] h-9"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                data-testid="input-search"
              />
            </div>
          )}
          {hasPairSelected && (
            <Button variant="default" size="sm" onClick={handleExportExcel} data-testid="button-export">
              <FileSpreadsheet className="w-4 h-4 mr-2" />
              Export Excel
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={handleDownloadTemplate} data-testid="button-download-template">
            <Download className="w-4 h-4 mr-2" />
            Download Template
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleUploadReconciliation}
            disabled={uploadReconciliationMutation.isPending}
            data-testid="button-upload-matches"
          >
            {uploadReconciliationMutation.isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Upload className="w-4 h-4 mr-2" />
            )}
            Upload Matches
          </Button>
        </div>
      </div>

      {selectionMode && (
        <div className="flex items-center justify-between bg-primary/5 border border-primary/20 rounded-lg px-4 py-3">
          <div className="flex items-center gap-4 text-sm">
            <Link2 className="w-4 h-4 text-primary" />
            <span className="font-semibold">Manual Match Mode</span>
            <span className="text-muted-foreground">
              Select lines from both grids to manually reconcile
            </span>
          </div>
          <div className="flex items-center gap-3">
            {totalSelected > 0 && (
              <div className="flex items-center gap-3 text-xs">
                <span className="font-medium">{totalSelected} selected</span>
                {selectedFromA.length > 0 && (
                  <Badge variant="outline">
                    {entityAList.length === 1 ? entityAList[0].slice(0, 15) : `A(${entityAList.length})`}: {selectedFromA.length}
                  </Badge>
                )}
                {selectedFromB.length > 0 && (
                  <Badge variant="outline">
                    {entityBList.length === 1 ? entityBList[0].slice(0, 15) : "Entity B"}: {selectedFromB.length}
                  </Badge>
                )}
                <span className={amountsMatch ? "text-emerald-600 font-medium" : "text-muted-foreground"}>
                  +{formatAmount(totalPositive)} / -{formatAmount(totalNegative)}
                  {hasBothSides && (amountsMatch
                    ? " ✓ Balanced"
                    : ` (Diff: ${formatAmount(Math.abs(totalPositive - totalNegative))})`
                  )}
                </span>
              </div>
            )}
            <Button
              size="sm"
              onClick={handleManualMatch}
              disabled={!hasBothSides || !amountsMatch || manualMatchMutation.isPending}
              data-testid="button-confirm-manual-match"
            >
              {manualMatchMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Link2 className="w-4 h-4 mr-2" />
              )}
              Match Selected ({totalSelected})
            </Button>
            <Button size="sm" variant="ghost" onClick={handleCancelSelection} data-testid="button-cancel-manual-match">
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      {activeTab === "overview" && (
        <Card className="flex-1">
          <CardContent className="p-0">
            {pairsLoading ? (
              <div className="p-6 space-y-3">
                {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
              </div>
            ) : overviewPairs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16">
                <ArrowLeftRight className="w-10 h-10 text-muted-foreground mb-3" />
                <h3 className="text-base font-semibold mb-1" data-testid="text-empty-grid">No Company Pairs</h3>
                <p className="text-sm text-muted-foreground">Upload transactions to see intercompany relationships</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="table-company-pairs">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Entity A</th>
                      <th className="text-center py-3 px-2"></th>
                      <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Entity B</th>
                      <th className="text-center py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Total</th>
                      <th className="text-center py-3 px-4 text-xs font-semibold text-emerald-600 uppercase tracking-wider">Matched</th>
                      <th className="text-center py-3 px-4 text-xs font-semibold text-red-600 uppercase tracking-wider">Unmatched</th>
                      <th className="text-right py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Total Debit</th>
                      <th className="text-right py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Total Credit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overviewPairs.map((pair) => (
                      <tr
                        key={`${pair.company}-${pair.counterParty}`}
                        className="border-b last:border-0 cursor-pointer hover:bg-muted/30 transition-colors"
                        onClick={() => { setEntityAList([pair.company]); setEntityBList([pair.counterParty]); setActiveTab("grid"); }}
                        data-testid={`row-pair-${pair.company}-${pair.counterParty}`}
                      >
                        <td className="py-3 px-4 font-medium text-sm">{displayName(pair.company) || "(blank)"}</td>
                        <td className="py-3 px-2 text-center"><ArrowLeftRight className="w-3.5 h-3.5 text-muted-foreground inline-block" /></td>
                        <td className="py-3 px-4 font-medium text-sm">{displayName(pair.counterParty) || "(blank)"}</td>
                        <td className="py-3 px-4 text-center"><Badge variant="outline">{pair.total}</Badge></td>
                        <td className="py-3 px-4 text-center">
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">{pair.matched}</span>
                        </td>
                        <td className="py-3 px-4 text-center">
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">{pair.unmatched}</span>
                        </td>
                        <td className="py-3 px-4 text-right text-xs font-mono">{formatAmount(pair.totalDebit)}</td>
                        <td className="py-3 px-4 text-right text-xs font-mono">{formatAmount(pair.totalCredit)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {activeTab === "grid" && (
        <>
          {!hasPairSelected ? (
            <Card className="flex-1">
              <CardContent className="flex flex-col items-center justify-center py-16">
                <ArrowLeftRight className="w-10 h-10 text-muted-foreground mb-3" />
                <h3 className="text-base font-semibold mb-1">Select Entities</h3>
                <p className="text-sm text-muted-foreground">Choose Entity A and Entity B above to view the reconciliation grid</p>
              </CardContent>
            </Card>
          ) : loadingA || loadingB ? (
            <div className="flex gap-4 flex-1">
              {[1, 2].map((i) => (
                <div key={i} className="flex-1 border rounded-lg p-6 space-y-3">
                  {[1, 2, 3, 4, 5].map((j) => <Skeleton key={j} className="h-10 w-full" />)}
                </div>
              ))}
            </div>
          ) : (
            <div className="flex gap-4 flex-1 min-h-0">
              <EntityPanel
                entityName={entityAList.length === 1 ? displayName(entityAList[0]) : `Entity A (${entityAList.length})`}
                lines={linesA || []}
                searchQuery={searchQuery}
                isPartyA={true}
                selectedIds={selectedIds}
                onToggleSelect={handleToggleSelect}
                onSelectAll={handleSelectAll}
                selectionMode={selectionMode}
                statusFilter={statusFilter}
                onReconIdClick={setSelectedReconId}
              />
              <EntityPanel
                entityName={entityBList.length === 1 ? displayName(entityBList[0]) : `Counter Parties (${entityBList.length})`}
                lines={linesB || []}
                searchQuery={searchQuery}
                isPartyA={false}
                selectedIds={selectedIds}
                onToggleSelect={handleToggleSelect}
                onSelectAll={handleSelectAll}
                selectionMode={selectionMode}
                statusFilter={statusFilter}
                onReconIdClick={setSelectedReconId}
              />
            </div>
          )}
        </>
      )}

      <ReconGroupDialog
        reconId={selectedReconId}
        open={!!selectedReconId}
        onOpenChange={(open) => { if (!open) setSelectedReconId(null); }}
      />
    </div>
  );
}
