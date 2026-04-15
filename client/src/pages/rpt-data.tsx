import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Download, Search, Filter, X } from "lucide-react";
import { MultiSelectFilter } from "@/components/ui/multi-select-filter";

function formatNum(val: number | null | undefined): string {
  if (val === null || val === undefined) return "0";
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(val);
}

interface RptSummaryRow {
  company: string;
  companyName: string;
  counterParty: string;
  counterPartyName: string;
  transactionType: string;
  rptTxnTypeDetailed: string;
  rptType: string;
  amount: number;
  rowCount: number;
}

export default function RptDataPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [icTxnTypeFilter, setIcTxnTypeFilter] = useState<string[]>([]);
  const [rptTypeFilter, setRptTypeFilter] = useState<string[]>([]);
  const [companyFilter, setCompanyFilter] = useState<string[]>([]);
  const [counterPartyFilter, setCounterPartyFilter] = useState<string[]>([]);
  const [rptTxnTypeDetailedFilter, setRptTxnTypeDetailedFilter] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState("detail");
  const [summarySearch, setSummarySearch] = useState("");
  const [summarySearchInput, setSummarySearchInput] = useState("");
  const [summaryRptFilter, setSummaryRptFilter] = useState<string[]>([]);
  const [summaryCompanyFilter, setSummaryCompanyFilter] = useState<string[]>([]);
  const [summaryCpFilter, setSummaryCpFilter] = useState<string[]>([]);
  const [summaryTxnTypeFilter, setSummaryTxnTypeFilter] = useState<string[]>([]);
  const [summaryTxnDetailedFilter, setSummaryTxnDetailedFilter] = useState<string[]>([]);

  const { data: rptData, isLoading } = useQuery<any>({
    queryKey: ["/api/recon/rpt-data", page, search, icTxnTypeFilter, rptTypeFilter, companyFilter, counterPartyFilter, rptTxnTypeDetailedFilter],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: "50" });
      if (search) params.set("search", search);
      if (icTxnTypeFilter.length) params.set("icTxnType", icTxnTypeFilter.join(","));
      if (rptTypeFilter.length) params.set("rptType", rptTypeFilter.join(","));
      if (companyFilter.length) params.set("company", companyFilter.join(","));
      if (counterPartyFilter.length) params.set("counterParty", counterPartyFilter.join(","));
      if (rptTxnTypeDetailedFilter.length) params.set("rptTxnTypeDetailed", rptTxnTypeDetailedFilter.join(","));
      const res = await fetch(`/api/recon/rpt-data?${params}`);
      if (!res.ok) throw new Error("Failed to load RPT data");
      return res.json();
    },
  });

  const { data: summaryData, isLoading: loadingSummary } = useQuery<{ data: RptSummaryRow[]; total: number }>({
    queryKey: ["/api/recon/rpt-summary"],
  });

  const summaryCompanies = useMemo(() => {
    if (!summaryData?.data) return [];
    const map = new Map<string, string>();
    for (const r of summaryData.data) {
      if (r.company && r.companyName) map.set(r.company, r.companyName);
    }
    return Array.from(map.entries()).map(([code, name]) => ({ code, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [summaryData]);

  const summaryCpList = useMemo(() => {
    if (!summaryData?.data) return [];
    const map = new Map<string, string>();
    for (const r of summaryData.data) {
      if (r.counterParty && r.counterPartyName) map.set(r.counterParty, r.counterPartyName);
    }
    return Array.from(map.entries()).map(([code, name]) => ({ code, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [summaryData]);

  const summaryRptTypes = useMemo(() => {
    if (!summaryData?.data) return [];
    const set = new Set<string>();
    for (const r of summaryData.data) {
      if (r.rptType) set.add(r.rptType);
    }
    return Array.from(set).sort();
  }, [summaryData]);

  const summaryTxnTypes = useMemo(() => {
    if (!summaryData?.data) return [];
    const set = new Set<string>();
    for (const r of summaryData.data) {
      if (r.transactionType) set.add(r.transactionType);
    }
    return Array.from(set).sort();
  }, [summaryData]);

  const summaryTxnDetailedTypes = useMemo(() => {
    if (!summaryData?.data) return [];
    const set = new Set<string>();
    for (const r of summaryData.data) {
      if (r.rptTxnTypeDetailed) set.add(r.rptTxnTypeDetailed);
    }
    return Array.from(set).sort();
  }, [summaryData]);

  const filteredSummary = useMemo(() => {
    if (!summaryData?.data) return [];
    let rows = summaryData.data;
    if (summaryRptFilter.length) {
      const set = new Set(summaryRptFilter);
      rows = rows.filter(r => set.has(r.rptType));
    }
    if (summaryCompanyFilter.length) {
      const set = new Set(summaryCompanyFilter);
      rows = rows.filter(r => set.has(r.company));
    }
    if (summaryCpFilter.length) {
      const set = new Set(summaryCpFilter);
      rows = rows.filter(r => set.has(r.counterParty));
    }
    if (summaryTxnTypeFilter.length) {
      const set = new Set(summaryTxnTypeFilter);
      rows = rows.filter(r => set.has(r.transactionType));
    }
    if (summaryTxnDetailedFilter.length) {
      const set = new Set(summaryTxnDetailedFilter);
      rows = rows.filter(r => set.has(r.rptTxnTypeDetailed));
    }
    if (summarySearch) {
      const s = summarySearch.toLowerCase();
      rows = rows.filter(r =>
        r.company.toLowerCase().includes(s) ||
        r.companyName.toLowerCase().includes(s) ||
        r.counterParty.toLowerCase().includes(s) ||
        r.counterPartyName.toLowerCase().includes(s) ||
        r.transactionType.toLowerCase().includes(s) ||
        (r.rptTxnTypeDetailed || "").toLowerCase().includes(s)
      );
    }
    return rows;
  }, [summaryData, summaryRptFilter, summaryCompanyFilter, summaryCpFilter, summaryTxnTypeFilter, summaryTxnDetailedFilter, summarySearch]);

  const summaryTotals = useMemo(() => {
    return filteredSummary.reduce((sum, r) => sum + r.amount, 0);
  }, [filteredSummary]);

  const handleSearch = () => {
    setSearch(searchInput);
    setPage(1);
  };

  const clearFilters = () => {
    setIcTxnTypeFilter([]);
    setRptTypeFilter([]);
    setCompanyFilter([]);
    setCounterPartyFilter([]);
    setRptTxnTypeDetailedFilter([]);
    setSearch("");
    setSearchInput("");
    setPage(1);
  };

  const handleSummarySearch = () => {
    setSummarySearch(summarySearchInput);
  };

  const clearSummaryFilters = () => {
    setSummaryRptFilter([]);
    setSummaryCompanyFilter([]);
    setSummaryCpFilter([]);
    setSummaryTxnTypeFilter([]);
    setSummaryTxnDetailedFilter([]);
    setSummarySearch("");
    setSummarySearchInput("");
  };

  const hasActiveFilters = icTxnTypeFilter.length > 0 || rptTypeFilter.length > 0 || companyFilter.length > 0 || counterPartyFilter.length > 0 || rptTxnTypeDetailedFilter.length > 0 || !!search;
  const hasSummaryFilters = summaryRptFilter.length > 0 || summaryCompanyFilter.length > 0 || summaryCpFilter.length > 0 || summaryTxnTypeFilter.length > 0 || summaryTxnDetailedFilter.length > 0 || !!summarySearch;

  return (
    <div className="p-6 space-y-4" data-testid="page-rpt-data">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">
            RPT Transaction Data
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            GL records where IC-RPT GL Name starts with IC_ or RPT_
            {rptData?.total ? ` — ${formatNum(rptData.total)} records` : ""}
          </p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList data-testid="tabs-rpt">
          <TabsTrigger value="detail" data-testid="tab-rpt-detail">Detail</TabsTrigger>
          <TabsTrigger value="summary" data-testid="tab-rpt-summary">Summary</TabsTrigger>
        </TabsList>

        <TabsContent value="detail" className="space-y-4">
          <Card data-testid="card-rpt-data">
            <CardHeader className="pb-2">
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">RPT Detail Records</CardTitle>
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
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => window.open("/api/recon/download-rpt-data", "_blank")}
                      disabled={!rptData?.total}
                      data-testid="button-download-rpt"
                    >
                      <Download className="w-4 h-4 mr-1" />
                      Download
                    </Button>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Filter className="w-4 h-4 text-muted-foreground" />
                  <MultiSelectFilter
                    options={(rptData?.companies || []).map((c: any) => ({ value: c.code, label: c.name }))}
                    selected={companyFilter}
                    onChange={(v) => { setCompanyFilter(v); setPage(1); }}
                    placeholder="Company Name"
                    className="w-52"
                    data-testid="select-detail-company"
                  />
                  <MultiSelectFilter
                    options={(rptData?.counterParties || []).map((c: any) => ({ value: c.code, label: c.name }))}
                    selected={counterPartyFilter}
                    onChange={(v) => { setCounterPartyFilter(v); setPage(1); }}
                    placeholder="Counter Party"
                    className="w-52"
                    data-testid="select-detail-cp"
                  />
                  <MultiSelectFilter
                    options={["IC", "RPT"].map(v => ({ value: v, label: v }))}
                    selected={rptTypeFilter}
                    onChange={(v) => { setRptTypeFilter(v); setPage(1); }}
                    placeholder="RPT Type"
                    className="w-36"
                    data-testid="select-rpt-type"
                  />
                  <MultiSelectFilter
                    options={(rptData?.icTxnTypes || []).map((t: string) => ({ value: t, label: t }))}
                    selected={icTxnTypeFilter}
                    onChange={(v) => { setIcTxnTypeFilter(v); setPage(1); }}
                    placeholder="RPT Txn Type"
                    className="w-44"
                    data-testid="select-ic-txn-type"
                  />
                  <MultiSelectFilter
                    options={(rptData?.rptTxnTypesDetailed || []).map((t: string) => ({ value: t, label: t }))}
                    selected={rptTxnTypeDetailedFilter}
                    onChange={(v) => { setRptTxnTypeDetailedFilter(v); setPage(1); }}
                    placeholder="RPT Txn Type Detailed"
                    className="w-52"
                    data-testid="select-rpt-txn-detailed"
                  />

                  {hasActiveFilters && (
                    <Button size="sm" variant="ghost" onClick={clearFilters} className="h-8 text-xs" data-testid="button-clear-filters">
                      <X className="w-3.5 h-3.5 mr-1" />
                      Clear
                    </Button>
                  )}
                </div>
                {hasActiveFilters && (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {companyFilter.map(v => {
                      const label = (rptData?.companies || []).find((c: any) => c.code === v)?.name || v;
                      return <Badge key={`co-${v}`} variant="secondary" className="text-[10px]">Company: {label}</Badge>;
                    })}
                    {counterPartyFilter.map(v => {
                      const label = (rptData?.counterParties || []).find((c: any) => c.code === v)?.name || v;
                      return <Badge key={`cp-${v}`} variant="secondary" className="text-[10px]">CP: {label}</Badge>;
                    })}
                    {rptTypeFilter.map(v => <Badge key={`rt-${v}`} variant="secondary" className="text-[10px]">RPT Type: {v}</Badge>)}
                    {icTxnTypeFilter.map(v => <Badge key={`tt-${v}`} variant="secondary" className="text-[10px]">RPT Txn: {v}</Badge>)}
                    {rptTxnTypeDetailedFilter.map(v => <Badge key={`td-${v}`} variant="secondary" className="text-[10px]">Detailed: {v}</Badge>)}
                    {search && <Badge variant="secondary" className="text-[10px]">Search: {search}</Badge>}
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              ) : !rptData?.data?.length ? (
                <p className="text-xs text-muted-foreground text-center py-10">
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
                          <th className="text-left p-2 font-medium whitespace-nowrap">Counter Party Name</th>
                          <th className="text-left p-2 font-medium whitespace-nowrap">Counter Party Code</th>
                          <th className="text-left p-2 font-medium whitespace-nowrap">Document No</th>
                          <th className="text-left p-2 font-medium whitespace-nowrap">Doc Date</th>
                          <th className="text-left p-2 font-medium whitespace-nowrap">Account Head</th>
                          <th className="text-left p-2 font-medium whitespace-nowrap">Sub Account Head</th>
                          <th className="text-left p-2 font-medium whitespace-nowrap">IC-RPT GL Name</th>
                          <th className="text-left p-2 font-medium whitespace-nowrap">RPT Txn Type</th>
                          <th className="text-left p-2 font-medium whitespace-nowrap">RPT Txn Type Detailed</th>
                          <th className="text-left p-2 font-medium whitespace-nowrap">RPT Type</th>
                          <th className="text-right p-2 font-medium whitespace-nowrap">Net Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rptData.data.map((row: any, idx: number) => (
                          <tr key={idx} className="border-t hover:bg-muted/30" data-testid={`row-rpt-${idx}`}>
                            <td className="p-2 max-w-[200px] truncate" title={row.company}>{row.company}</td>
                            <td className="p-2 whitespace-nowrap">{row.companyCode}</td>
                            <td className="p-2 max-w-[200px] truncate" title={row.counterPartyName}>{row.counterPartyName}</td>
                            <td className="p-2 whitespace-nowrap">{row.counterPartyCode}</td>
                            <td className="p-2 whitespace-nowrap font-mono">{row.documentNo}</td>
                            <td className="p-2 whitespace-nowrap">{row.docDate}</td>
                            <td className="p-2 max-w-[200px] truncate" title={row.accountHead}>{row.accountHead}</td>
                            <td className="p-2 max-w-[200px] truncate" title={row.subAccountHead}>{row.subAccountHead}</td>
                            <td className="p-2 max-w-[180px] truncate" title={row.icRptGlName}>{row.icRptGlName}</td>
                            <td className="p-2 whitespace-nowrap">{row.icTxnType}</td>
                            <td className="p-2 whitespace-nowrap">{row.rptTxnTypeDetailed}</td>
                            <td className="p-2 whitespace-nowrap">
                              {row.rptType && (
                                <Badge variant={row.rptType === "IC" ? "default" : "secondary"} className="text-[10px] px-1.5">
                                  {row.rptType}
                                </Badge>
                              )}
                            </td>
                            <td className="p-2 text-right whitespace-nowrap font-medium">{formatNum(Number(row.netAmount))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex items-center justify-between p-3">
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
        </TabsContent>

        <TabsContent value="summary" className="space-y-4">
          <Card data-testid="card-rpt-summary">
            <CardHeader className="pb-2">
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">RPT Summary</CardTitle>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-[10px]">{filteredSummary.length} groups</Badge>
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                      <Input
                        placeholder="Search company, counter party..."
                        value={summarySearchInput}
                        onChange={(e) => setSummarySearchInput(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleSummarySearch()}
                        className="h-8 w-64 text-xs pl-8"
                        data-testid="input-rpt-summary-search"
                      />
                    </div>
                    <Button size="sm" variant="outline" onClick={handleSummarySearch} data-testid="button-rpt-summary-search">
                      Search
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => window.open("/api/recon/download-rpt-summary", "_blank")}
                      disabled={!summaryData?.total}
                      data-testid="button-download-rpt-summary"
                    >
                      <Download className="w-4 h-4 mr-1" />
                      Download
                    </Button>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Filter className="w-4 h-4 text-muted-foreground" />
                  <MultiSelectFilter
                    options={summaryCompanies.map(c => ({ value: c.code, label: c.name }))}
                    selected={summaryCompanyFilter}
                    onChange={setSummaryCompanyFilter}
                    placeholder="Company Name"
                    className="w-52"
                    data-testid="select-summary-company"
                  />
                  <MultiSelectFilter
                    options={summaryCpList.map(c => ({ value: c.code, label: c.name }))}
                    selected={summaryCpFilter}
                    onChange={setSummaryCpFilter}
                    placeholder="Counter Party"
                    className="w-52"
                    data-testid="select-summary-cp"
                  />
                  <MultiSelectFilter
                    options={summaryRptTypes.map(v => ({ value: v, label: v }))}
                    selected={summaryRptFilter}
                    onChange={setSummaryRptFilter}
                    placeholder="RPT Type"
                    className="w-36"
                    data-testid="select-summary-rpt-type"
                  />
                  <MultiSelectFilter
                    options={summaryTxnTypes.map(v => ({ value: v, label: v }))}
                    selected={summaryTxnTypeFilter}
                    onChange={setSummaryTxnTypeFilter}
                    placeholder="RPT Txn Type"
                    className="w-44"
                    data-testid="select-summary-txn-type"
                  />
                  <MultiSelectFilter
                    options={summaryTxnDetailedTypes.map(v => ({ value: v, label: v }))}
                    selected={summaryTxnDetailedFilter}
                    onChange={setSummaryTxnDetailedFilter}
                    placeholder="RPT Txn Type Detailed"
                    className="w-52"
                    data-testid="select-summary-txn-detailed"
                  />

                  {hasSummaryFilters && (
                    <Button size="sm" variant="ghost" onClick={clearSummaryFilters} className="h-8 text-xs" data-testid="button-clear-summary-filters">
                      <X className="w-3.5 h-3.5 mr-1" />
                      Clear
                    </Button>
                  )}
                </div>
                {hasSummaryFilters && (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {summaryCompanyFilter.map(v => {
                      const label = summaryCompanies.find(c => c.code === v)?.name || v;
                      return <Badge key={`sco-${v}`} variant="secondary" className="text-[10px]">Company: {label}</Badge>;
                    })}
                    {summaryCpFilter.map(v => {
                      const label = summaryCpList.find(c => c.code === v)?.name || v;
                      return <Badge key={`scp-${v}`} variant="secondary" className="text-[10px]">CP: {label}</Badge>;
                    })}
                    {summaryRptFilter.map(v => <Badge key={`srt-${v}`} variant="secondary" className="text-[10px]">RPT Type: {v}</Badge>)}
                    {summaryTxnTypeFilter.map(v => <Badge key={`stt-${v}`} variant="secondary" className="text-[10px]">RPT Txn: {v}</Badge>)}
                    {summaryTxnDetailedFilter.map(v => <Badge key={`std-${v}`} variant="secondary" className="text-[10px]">Detailed: {v}</Badge>)}
                    {summarySearch && <Badge variant="secondary" className="text-[10px]">Search: {summarySearch}</Badge>}
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {loadingSummary ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              ) : filteredSummary.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-10">
                  No RPT summary data available.
                </p>
              ) : (
                <div className="overflow-auto max-h-[calc(100vh-380px)]">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50 sticky top-0">
                      <tr>
                        <th className="text-left p-2 font-medium whitespace-nowrap">#</th>
                        <th className="text-left p-2 font-medium whitespace-nowrap">Company Name</th>
                        <th className="text-left p-2 font-medium whitespace-nowrap">Company Code</th>
                        <th className="text-left p-2 font-medium whitespace-nowrap">Counter Party Name</th>
                        <th className="text-left p-2 font-medium whitespace-nowrap">Counter Party Code</th>
                        <th className="text-left p-2 font-medium whitespace-nowrap">RPT Txn Type</th>
                        <th className="text-left p-2 font-medium whitespace-nowrap">RPT Txn Type Detailed</th>
                        <th className="text-left p-2 font-medium whitespace-nowrap">RPT Type</th>
                        <th className="text-right p-2 font-medium whitespace-nowrap">Count</th>
                        <th className="text-right p-2 font-medium whitespace-nowrap">Net Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredSummary.map((row, idx) => (
                        <tr key={idx} className="border-t hover:bg-muted/30" data-testid={`row-rpt-summary-${idx}`}>
                          <td className="p-2 text-muted-foreground">{idx + 1}</td>
                          <td className="p-2 max-w-[200px] truncate" title={row.companyName}>{row.companyName}</td>
                          <td className="p-2 whitespace-nowrap">{row.company}</td>
                          <td className="p-2 max-w-[200px] truncate" title={row.counterPartyName}>{row.counterPartyName}</td>
                          <td className="p-2 whitespace-nowrap">{row.counterParty}</td>
                          <td className="p-2 whitespace-nowrap">{row.transactionType}</td>
                          <td className="p-2 whitespace-nowrap">{row.rptTxnTypeDetailed}</td>
                          <td className="p-2 whitespace-nowrap">
                            <Badge variant={row.rptType === "IC" ? "default" : "secondary"} className="text-[10px] px-1.5">
                              {row.rptType}
                            </Badge>
                          </td>
                          <td className="p-2 text-right whitespace-nowrap">{row.rowCount}</td>
                          <td className="p-2 text-right whitespace-nowrap font-medium">{formatNum(row.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-muted/30 border-t font-medium">
                      <tr>
                        <td className="p-2" colSpan={8}>Total</td>
                        <td className="p-2 text-right">{filteredSummary.reduce((s, r) => s + r.rowCount, 0)}</td>
                        <td className="p-2 text-right">{formatNum(summaryTotals)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
