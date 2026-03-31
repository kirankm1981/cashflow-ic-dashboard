import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BarChart3, Search, Download } from "lucide-react";
import * as XLSX from "xlsx";

interface EntityCounterPartyRow {
  entity: string;
  counterParty: string;
  total: number;
  matched: number;
  reversal: number;
  review: number;
  suggested: number;
  unmatched: number;
  rate: number;
}

function formatRate(rate: number): string {
  return `${rate.toFixed(1)}%`;
}

function getRateBadge(rate: number) {
  if (rate >= 90) return <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300" data-testid={`badge-rate-${rate}`}>{formatRate(rate)}</Badge>;
  if (rate >= 70) return <Badge className="bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300" data-testid={`badge-rate-${rate}`}>{formatRate(rate)}</Badge>;
  if (rate >= 50) return <Badge className="bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300" data-testid={`badge-rate-${rate}`}>{formatRate(rate)}</Badge>;
  return <Badge className="bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300" data-testid={`badge-rate-${rate}`}>{formatRate(rate)}</Badge>;
}

export default function Reports({ embedded = false }: { embedded?: boolean } = {}) {
  const [searchQuery, setSearchQuery] = useState("");

  const { data: rows, isLoading } = useQuery<EntityCounterPartyRow[]>({
    queryKey: ["/api/reports/entity-counterparty"],
  });
  const { data: nameMap } = useQuery<Record<string, string>>({
    queryKey: ["/api/company-name-map"],
  });
  const displayName = (code: string) => (nameMap && nameMap[code]) ? `${nameMap[code]} (${code})` : code;

  const filtered = (rows || []).filter(r => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return r.entity.toLowerCase().includes(q) || r.counterParty.toLowerCase().includes(q);
  });

  const totals = filtered.reduce(
    (acc, r) => ({
      total: acc.total + r.total,
      matched: acc.matched + r.matched,
      reversal: acc.reversal + r.reversal,
      review: acc.review + r.review,
      suggested: acc.suggested + r.suggested,
      unmatched: acc.unmatched + r.unmatched,
    }),
    { total: 0, matched: 0, reversal: 0, review: 0, suggested: 0, unmatched: 0 }
  );
  const overallRate = totals.total > 0 ? Math.round(((totals.matched + totals.reversal + totals.review + totals.suggested) / totals.total) * 10000) / 100 : 0;

  const handleExportReport = () => {
    if (!filtered || filtered.length === 0) return;
    const exportRows = filtered.map(r => ({
      "Entity": displayName(r.entity),
      "Counter Party": displayName(r.counterParty),
      "Total Transactions": r.total,
      "Matched": r.matched,
      "Reversal": r.reversal,
      "Review": r.review,
      "Suggested": r.suggested,
      "Unmatched": r.unmatched,
      "Rate (%)": r.rate,
    }));
    exportRows.push({
      "Entity": "TOTAL",
      "Counter Party": "",
      "Total Transactions": totals.total,
      "Matched": totals.matched,
      "Reversal": totals.reversal,
      "Review": totals.review,
      "Suggested": totals.suggested,
      "Unmatched": totals.unmatched,
      "Rate (%)": overallRate,
    });

    const ws = XLSX.utils.json_to_sheet(exportRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Entity Report");
    ws["!cols"] = [
      { wch: 30 }, { wch: 30 }, { wch: 18 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 10 },
    ];
    const dateStr = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `entity_counterparty_report_${dateStr}.xlsx`);
  };

  return (
    <div className={embedded ? "space-y-4" : "p-6 space-y-6"} data-testid="page-reports">
      <div className="flex items-center justify-between">
        {!embedded && (
          <div className="flex items-center gap-3">
            <BarChart3 className="w-6 h-6 text-primary" />
            <h1 className="text-2xl font-bold" data-testid="text-reports-title">Entity Reconciliation Report</h1>
          </div>
        )}
        <Button variant="outline" size="sm" onClick={handleExportReport} disabled={!filtered || filtered.length === 0} data-testid="button-export-report">
          <Download className="w-4 h-4 mr-1.5" />
          Export Report
        </Button>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Pairs</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-pairs">{isLoading ? <Skeleton className="h-8 w-16" /> : filtered.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Transactions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-txns">{isLoading ? <Skeleton className="h-8 w-16" /> : totals.total.toLocaleString()}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Overall Matched</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-600" data-testid="text-total-matched">{isLoading ? <Skeleton className="h-8 w-16" /> : totals.matched.toLocaleString()}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Overall Rate</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-overall-rate">{isLoading ? <Skeleton className="h-8 w-16" /> : formatRate(overallRate)}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Entity - Counter Party Breakdown</CardTitle>
            <div className="relative w-64">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search entity or counter party..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 h-9"
                data-testid="input-search-report"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-auto max-h-[60vh]">
            <table className="w-full text-sm" data-testid="table-entity-report">
              <thead className="sticky top-0 bg-muted/80 backdrop-blur z-10">
                <tr className="border-b">
                  <th className="text-left py-2.5 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Entity</th>
                  <th className="text-left py-2.5 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Counter Party</th>
                  <th className="text-right py-2.5 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Total</th>
                  <th className="text-right py-2.5 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Matched</th>
                  <th className="text-right py-2.5 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Reversal</th>
                  <th className="text-right py-2.5 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Review</th>
                  <th className="text-right py-2.5 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Suggested</th>
                  <th className="text-right py-2.5 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Unmatched</th>
                  <th className="text-center py-2.5 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Rate</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className="border-b">
                      {Array.from({ length: 9 }).map((_, j) => (
                        <td key={j} className="py-2.5 px-4"><Skeleton className="h-4 w-full" /></td>
                      ))}
                    </tr>
                  ))
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-8 text-center text-muted-foreground">No data available</td>
                  </tr>
                ) : (
                  <>
                    {filtered.map((row, idx) => (
                      <tr key={idx} className="border-b hover:bg-muted/30 transition-colors" data-testid={`row-report-${idx}`}>
                        <td className="py-2.5 px-4 font-medium" data-testid={`text-entity-${idx}`}>{displayName(row.entity)}</td>
                        <td className="py-2.5 px-4" data-testid={`text-counterparty-${idx}`}>{displayName(row.counterParty)}</td>
                        <td className="py-2.5 px-3 text-right font-mono" data-testid={`text-total-${idx}`}>{row.total.toLocaleString()}</td>
                        <td className="py-2.5 px-3 text-right font-mono text-emerald-600" data-testid={`text-matched-${idx}`}>{row.matched.toLocaleString()}</td>
                        <td className="py-2.5 px-3 text-right font-mono text-purple-600" data-testid={`text-reversal-${idx}`}>{row.reversal.toLocaleString()}</td>
                        <td className="py-2.5 px-3 text-right font-mono text-teal-600" data-testid={`text-review-${idx}`}>{row.review.toLocaleString()}</td>
                        <td className="py-2.5 px-3 text-right font-mono text-orange-600" data-testid={`text-suggested-${idx}`}>{row.suggested.toLocaleString()}</td>
                        <td className="py-2.5 px-3 text-right font-mono text-red-600" data-testid={`text-unmatched-${idx}`}>{row.unmatched.toLocaleString()}</td>
                        <td className="py-2.5 px-3 text-center" data-testid={`text-rate-${idx}`}>{getRateBadge(row.rate)}</td>
                      </tr>
                    ))}
                    <tr className="bg-muted/40 font-semibold border-t-2" data-testid="row-report-total">
                      <td className="py-2.5 px-4">TOTAL</td>
                      <td className="py-2.5 px-4"></td>
                      <td className="py-2.5 px-3 text-right font-mono">{totals.total.toLocaleString()}</td>
                      <td className="py-2.5 px-3 text-right font-mono text-emerald-600">{totals.matched.toLocaleString()}</td>
                      <td className="py-2.5 px-3 text-right font-mono text-purple-600">{totals.reversal.toLocaleString()}</td>
                      <td className="py-2.5 px-3 text-right font-mono text-teal-600">{totals.review.toLocaleString()}</td>
                      <td className="py-2.5 px-3 text-right font-mono text-orange-600">{totals.suggested.toLocaleString()}</td>
                      <td className="py-2.5 px-3 text-right font-mono text-red-600">{totals.unmatched.toLocaleString()}</td>
                      <td className="py-2.5 px-3 text-center">{getRateBadge(overallRate)}</td>
                    </tr>
                  </>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
