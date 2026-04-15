import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { SummarizedLine } from "@shared/schema";

function formatAmount(val: number | null): string {
  if (!val || val === 0) return "-";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
  }).format(val);
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "-";
  let d: Date | null = null;
  const num = parseFloat(dateStr);
  if (!isNaN(num) && num > 40000 && num < 60000) {
    d = new Date(1899, 11, 30);
    d.setDate(d.getDate() + num);
  } else {
    const parsed = new Date(dateStr);
    if (!isNaN(parsed.getTime())) d = parsed;
  }
  if (!d) return dateStr;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

export default function Exceptions({ embedded = false }: { embedded?: boolean } = {}) {
  const [search, setSearch] = useState("");

  const { data: lines, isLoading } = useQuery<SummarizedLine[]>({
    queryKey: ["/api/summarized-lines", "reconStatus", "unmatched"],
    queryFn: async () => {
      const res = await fetch("/api/summarized-lines?reconStatus=unmatched");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });
  const { data: nameMap } = useQuery<Record<string, string>>({
    queryKey: ["/api/company-name-map"],
  });
  const displayName = (code: string) => (nameMap && nameMap[code]) ? `${nameMap[code]} (${code})` : code;

  const filtered = lines?.filter((t) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      t.company.toLowerCase().includes(q) ||
      t.counterParty.toLowerCase().includes(q) ||
      (t.documentNo || "").toLowerCase().includes(q) ||
      (t.narration || "").toLowerCase().includes(q)
    );
  })?.sort((a, b) => {
    const parseD = (ds: string | null) => {
      if (!ds) return null;
      const n = parseFloat(ds);
      if (!isNaN(n) && n > 40000 && n < 60000) {
        const e = new Date(1899, 11, 30);
        e.setDate(e.getDate() + n);
        return e;
      }
      const p = new Date(ds);
      return isNaN(p.getTime()) ? null : p;
    };
    const da = parseD(a.docDate);
    const db2 = parseD(b.docDate);
    if (!da && !db2) return 0;
    if (!da) return 1;
    if (!db2) return -1;
    return da.getTime() - db2.getTime();
  });

  return (
    <div className={embedded ? "space-y-4" : "p-6 space-y-6"}>
      {!embedded && (
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Exception Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Unmatched transactions requiring review
          </p>
        </div>
      )}

      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search exceptions..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
                data-testid="input-search-exceptions"
              />
            </div>
            <Badge variant="secondary" data-testid="text-exception-count">
              {filtered?.length || 0} exceptions
            </Badge>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : !filtered || filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center mb-3">
                <AlertTriangle className="w-7 h-7 text-muted-foreground" />
              </div>
              <h3 className="text-base font-semibold mb-1">No Exceptions</h3>
              <p className="text-sm text-muted-foreground">All transactions are matched or no data uploaded</p>
            </div>
          ) : (
            <ScrollArea className="max-h-[60vh]">
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="table-exceptions">
                  <thead className="sticky top-0 bg-card z-10">
                    <tr className="border-b">
                      <th className="text-left py-2.5 px-3 text-xs font-medium text-muted-foreground uppercase">Company</th>
                      <th className="text-left py-2.5 px-3 text-xs font-medium text-muted-foreground uppercase">Counter Party</th>
                      <th className="text-left py-2.5 px-3 text-xs font-medium text-muted-foreground uppercase">Doc No</th>
                      <th className="text-left py-2.5 px-3 text-xs font-medium text-muted-foreground uppercase">Date</th>
                      <th className="text-right py-2.5 px-3 text-xs font-medium text-muted-foreground uppercase">Net Amount</th>
                      <th className="text-left py-2.5 px-3 text-xs font-medium text-muted-foreground uppercase">Narration</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((txn) => (
                      <tr
                        key={txn.id}
                        className="border-b last:border-0 hover:bg-muted/30 transition-colors"
                        data-testid={`row-exception-${txn.id}`}
                      >
                        <td className="py-2.5 px-3 max-w-[200px] truncate" title={displayName(txn.company)}>{displayName(txn.company)}</td>
                        <td className="py-2.5 px-3 max-w-[200px] truncate" title={displayName(txn.counterParty)}>{displayName(txn.counterParty)}</td>
                        <td className="py-2.5 px-3 text-xs font-mono">{txn.documentNo || "-"}</td>
                        <td className="py-2.5 px-3 text-xs">{formatDate(txn.docDate)}</td>
                        <td className={`py-2.5 px-3 text-right text-xs font-mono ${(txn.netAmount || 0) < 0 ? "text-red-600" : "text-emerald-600"}`}>{formatAmount(txn.netAmount)}</td>
                        <td className="py-2.5 px-3 text-xs max-w-[300px] truncate" title={txn.narration || ""}>
                          {txn.narration ? txn.narration.slice(0, 80) + (txn.narration.length > 80 ? "..." : "") : "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
