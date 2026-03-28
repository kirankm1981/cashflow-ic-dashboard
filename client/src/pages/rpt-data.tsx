import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Loader2, Download, Search, Filter, X } from "lucide-react";

function formatNum(val: number | null | undefined): string {
  if (val === null || val === undefined) return "0";
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(val);
}

export default function RptDataPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [icTxnTypeFilter, setIcTxnTypeFilter] = useState("");
  const [rptTypeFilter, setRptTypeFilter] = useState("");

  const { data: rptData, isLoading } = useQuery<any>({
    queryKey: ["/api/recon/rpt-data", page, search, icTxnTypeFilter, rptTypeFilter],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: "50" });
      if (search) params.set("search", search);
      if (icTxnTypeFilter) params.set("icTxnType", icTxnTypeFilter);
      if (rptTypeFilter) params.set("rptType", rptTypeFilter);
      const res = await fetch(`/api/recon/rpt-data?${params}`);
      if (!res.ok) throw new Error("Failed to load RPT data");
      return res.json();
    },
  });

  const handleSearch = () => {
    setSearch(searchInput);
    setPage(1);
  };

  const clearFilters = () => {
    setIcTxnTypeFilter("");
    setRptTypeFilter("");
    setSearch("");
    setSearchInput("");
    setPage(1);
  };

  const hasActiveFilters = icTxnTypeFilter || rptTypeFilter || search;

  return (
    <div className="p-6 space-y-6" data-testid="page-rpt-data">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">
            RPT Data
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            GL records where IC-RPT GL Name starts with IC_ or RPT_
            {rptData?.total ? ` — ${formatNum(rptData.total)} records` : ""}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => window.open("/api/recon/download-rpt-data", "_blank")}
          disabled={!rptData?.total}
          data-testid="button-download-rpt"
        >
          <Download className="w-4 h-4 mr-2" />
          Download RPT Data
        </Button>
      </div>

      <Card data-testid="card-rpt-data">
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">Records</CardTitle>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                  <Input
                    placeholder="Search doc no, GL name, company..."
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                    className="h-8 w-72 text-xs pl-8"
                    data-testid="input-rpt-search"
                  />
                </div>
                <Button size="sm" variant="outline" onClick={handleSearch} data-testid="button-rpt-search">
                  Search
                </Button>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Filter className="w-4 h-4 text-muted-foreground" />
              <Select
                value={rptTypeFilter || "_all_"}
                onValueChange={(v) => { setRptTypeFilter(v === "_all_" ? "" : v); setPage(1); }}
              >
                <SelectTrigger className="h-8 w-40 text-xs" data-testid="select-rpt-type">
                  <SelectValue placeholder="RPT Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all_">All RPT Types</SelectItem>
                  <SelectItem value="IC">IC</SelectItem>
                  <SelectItem value="RPT">RPT</SelectItem>
                </SelectContent>
              </Select>

              <Select
                value={icTxnTypeFilter || "_all_"}
                onValueChange={(v) => { setIcTxnTypeFilter(v === "_all_" ? "" : v); setPage(1); }}
              >
                <SelectTrigger className="h-8 w-48 text-xs" data-testid="select-ic-txn-type">
                  <SelectValue placeholder="IC Txn Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all_">All IC Txn Types</SelectItem>
                  {(rptData?.icTxnTypes || []).map((t: string) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {hasActiveFilters && (
                <Button size="sm" variant="ghost" onClick={clearFilters} className="h-8 text-xs" data-testid="button-clear-filters">
                  <X className="w-3.5 h-3.5 mr-1" />
                  Clear Filters
                </Button>
              )}

              {hasActiveFilters && (
                <div className="flex items-center gap-1.5 ml-2">
                  {rptTypeFilter && <Badge variant="secondary" className="text-xs">RPT Type: {rptTypeFilter}</Badge>}
                  {icTxnTypeFilter && <Badge variant="secondary" className="text-xs">IC Txn Type: {icTxnTypeFilter}</Badge>}
                  {search && <Badge variant="secondary" className="text-xs">Search: {search}</Badge>}
                </div>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : !rptData?.data?.length ? (
            <p className="text-sm text-muted-foreground text-center py-10">
              No RPT data found. Upload GL dump files with IC_/RPT_ mapped GL names to see data here.
            </p>
          ) : (
            <>
              <div className="rounded border overflow-auto max-h-[calc(100vh-380px)]">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr>
                      <th className="text-left p-2 font-medium whitespace-nowrap">Company Name</th>
                      <th className="text-left p-2 font-medium whitespace-nowrap">Company Code</th>
                      <th className="text-left p-2 font-medium whitespace-nowrap">Document No</th>
                      <th className="text-left p-2 font-medium whitespace-nowrap">Doc Date</th>
                      <th className="text-left p-2 font-medium whitespace-nowrap">Account Head</th>
                      <th className="text-left p-2 font-medium whitespace-nowrap">IC-RPT GL Name</th>
                      <th className="text-left p-2 font-medium whitespace-nowrap">IC Txn Type</th>
                      <th className="text-left p-2 font-medium whitespace-nowrap">RPT Type</th>
                      <th className="text-right p-2 font-medium whitespace-nowrap">Debit</th>
                      <th className="text-right p-2 font-medium whitespace-nowrap">Credit</th>
                      <th className="text-right p-2 font-medium whitespace-nowrap">Net Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rptData.data.map((row: any, idx: number) => (
                      <tr key={idx} className="border-t hover:bg-muted/30" data-testid={`row-rpt-${idx}`}>
                        <td className="p-2 max-w-[200px] truncate" title={row.company}>{row.company}</td>
                        <td className="p-2 whitespace-nowrap">{row.companyCode}</td>
                        <td className="p-2 whitespace-nowrap font-mono">{row.documentNo}</td>
                        <td className="p-2 whitespace-nowrap">{row.docDate}</td>
                        <td className="p-2 max-w-[200px] truncate" title={row.accountHead}>{row.accountHead}</td>
                        <td className="p-2 max-w-[180px] truncate" title={row.icRptGlName}>{row.icRptGlName}</td>
                        <td className="p-2 whitespace-nowrap">{row.icTxnType}</td>
                        <td className="p-2 whitespace-nowrap">
                          {row.rptType && (
                            <Badge variant={row.rptType === "IC" ? "default" : "secondary"} className="text-[10px] px-1.5">
                              {row.rptType}
                            </Badge>
                          )}
                        </td>
                        <td className="p-2 text-right whitespace-nowrap">{formatNum(Number(row.debit))}</td>
                        <td className="p-2 text-right whitespace-nowrap">{formatNum(Number(row.credit))}</td>
                        <td className="p-2 text-right whitespace-nowrap font-medium">{formatNum(Number(row.netAmount))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between mt-3">
                <p className="text-xs text-muted-foreground">
                  Page {rptData.page} of {rptData.totalPages} ({formatNum(rptData.total)} total)
                </p>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={page <= 1}
                    onClick={() => setPage(p => p - 1)}
                    data-testid="button-rpt-prev"
                  >
                    Previous
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={page >= rptData.totalPages}
                    onClick={() => setPage(p => p + 1)}
                    data-testid="button-rpt-next"
                  >
                    Next
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
