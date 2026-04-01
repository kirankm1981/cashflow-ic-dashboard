import { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Grid3X3,
  Building2,
  ArrowLeftRight,
  Table2,
  Download,
  ChevronLeft,
  ChevronRight,
  Search,
  FileSpreadsheet,
  AlertTriangle,
  CheckCircle,
  X,
  Filter,
  ChevronDown,
  Check,
} from "lucide-react";
import { Link } from "wouter";
import { useDashboardSettings } from "@/hooks/use-dashboard-settings";
import { formatAmount } from "@/lib/number-format";
import { ChartFormatSettings } from "@/components/chart-format-settings";

function MultiSelectDropdown({
  label,
  options,
  selected,
  onChange,
  codeToName,
  testId,
}: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (val: string[]) => void;
  codeToName: Record<string, string>;
  testId: string;
}) {
  const [open, setOpen] = useState(false);
  const [filterText, setFilterText] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const filtered = filterText
    ? options.filter(
        (o) =>
          o.toLowerCase().includes(filterText.toLowerCase()) ||
          (codeToName[o] || "").toLowerCase().includes(filterText.toLowerCase())
      )
    : options;

  const toggle = (code: string) => {
    onChange(
      selected.includes(code)
        ? selected.filter((s) => s !== code)
        : [...selected, code]
    );
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 h-8 px-3 text-xs border rounded-md bg-background hover:bg-muted/50 transition-colors min-w-[140px] max-w-[220px]"
        data-testid={testId}
      >
        <Filter className="w-3 h-3 text-muted-foreground shrink-0" />
        <span className="truncate">
          {selected.length === 0
            ? `All ${label}`
            : selected.length === 1
            ? selected[0]
            : `${selected.length} ${label}`}
        </span>
        <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0 ml-auto" />
      </button>
      {open && (
        <div className="absolute top-full mt-1 left-0 z-50 bg-popover border rounded-md shadow-lg w-[260px] max-h-[320px] flex flex-col">
          <div className="p-2 border-b">
            <Input
              placeholder={`Search ${label.toLowerCase()}...`}
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              className="h-7 text-xs"
              autoFocus
            />
          </div>
          <div className="flex items-center justify-between px-2 py-1.5 border-b">
            <button
              className="text-[11px] text-primary hover:underline"
              onClick={() => onChange([...options])}
            >
              Select All
            </button>
            <button
              className="text-[11px] text-muted-foreground hover:underline"
              onClick={() => onChange([])}
            >
              Clear All
            </button>
          </div>
          <div className="overflow-auto flex-1">
            {filtered.map((code) => (
              <button
                key={code}
                className="flex items-center gap-2 w-full px-2 py-1.5 text-xs hover:bg-muted/50 text-left"
                onClick={() => toggle(code)}
              >
                <div
                  className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                    selected.includes(code)
                      ? "bg-primary border-primary text-primary-foreground"
                      : "border-muted-foreground/30"
                  }`}
                >
                  {selected.includes(code) && <Check className="w-3 h-3" />}
                </div>
                <span className="font-medium">{code}</span>
                {codeToName[code] && (
                  <span className="text-muted-foreground truncate ml-1">
                    {codeToName[code]}
                  </span>
                )}
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="text-xs text-muted-foreground p-3 text-center">No matches</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function formatNum(val: number | null | undefined): string {
  if (val === null || val === undefined) return "0";
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(val);
}


export default function IcMatrix() {
  const [page, setPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedTbFile, setSelectedTbFile] = useState<string>("all");
  const [netOffSearch, setNetOffSearch] = useState("");
  const [selectedCompanies, setSelectedCompanies] = useState<string[]>([]);
  const [selectedCounterParties, setSelectedCounterParties] = useState<string[]>([]);
  const [selectedIcTxnTypes, setSelectedIcTxnTypes] = useState<string[]>([]);
  const limit = 100;
  const { getFormat } = useDashboardSettings();
  const matrixFmt = getFormat("ic-matrix");
  const netoffDetailFmt = getFormat("ic-netoff-details");

  const { data: summary } = useQuery<any>({
    queryKey: ["/api/ic-matrix/summary"],
  });

  const { data: dashboard, isLoading: dashLoading } = useQuery<any>({
    queryKey: ["/api/ic-matrix/dashboard", { icTxnTypes: selectedIcTxnTypes }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedIcTxnTypes.length > 0) params.set("icTxnTypes", selectedIcTxnTypes.join(","));
      const res = await fetch(`/api/ic-matrix/dashboard?${params}`);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const tbFileId = selectedTbFile !== "all" ? Number(selectedTbFile) : undefined;
  const { data: tbDataResult, isLoading: dataLoading } = useQuery<any>({
    queryKey: ["/api/ic-matrix/tb-data", { page, limit, tbFileId, companies: selectedCompanies, counterParties: selectedCounterParties, icTxnTypes: selectedIcTxnTypes }],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (tbFileId) params.set("tbFileId", String(tbFileId));
      if (selectedCompanies.length > 0) params.set("companyCodes", selectedCompanies.join(","));
      if (selectedCounterParties.length > 0) params.set("counterPartyCodes", selectedCounterParties.join(","));
      if (selectedIcTxnTypes.length > 0) params.set("icTxnTypes", selectedIcTxnTypes.join(","));
      const res = await fetch(`/api/ic-matrix/tb-data?${params}`);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const data = tbDataResult?.data || [];
  const total = tbDataResult?.total || 0;
  const totalPages = tbDataResult?.totalPages || 1;

  const filteredData = searchTerm
    ? data.filter((r: any) =>
        (r.company || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
        (r.accountHead || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
        (r.subAccountHead || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
        (r.newCoaGlName || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
        (r.icCounterParty || "").toLowerCase().includes(searchTerm.toLowerCase())
      )
    : data;

  const hasData = summary?.totalRecords > 0;
  const [activeMatrixTab, setActiveMatrixTab] = useState("matrix");

  const handleDownload = () => {
    const params = new URLSearchParams();
    if (selectedIcTxnTypes.length > 0) params.set("txnTypes", selectedIcTxnTypes.join(","));
    if (selectedCompanies.length > 0) params.set("companies", selectedCompanies.join(","));
    if (selectedCounterParties.length > 0) params.set("counterParties", selectedCounterParties.join(","));
    const qs = params.toString() ? `?${params.toString()}` : "";
    if (activeMatrixTab === "matrix") {
      window.open(`/api/ic-matrix/download-balance-matrix${qs}`, "_blank");
    } else if (activeMatrixTab === "netoffmatrix" || activeMatrixTab === "netoff") {
      window.open(`/api/ic-matrix/download-netoff-matrix${qs}`, "_blank");
    } else {
      window.open("/api/ic-matrix/download", "_blank");
    }
  };

  const matrixData = dashboard?.matrix || [];
  const companyCodes = dashboard?.companyCodes || [];
  const counterPartyCodes = dashboard?.counterPartyCodes || [];
  const icTxnTypes: string[] = dashboard?.icTxnTypes || [];
  const columnTotals = dashboard?.columnTotals || {};
  const codeToName: Record<string, string> = dashboard?.codeToName || {};
  const netOffSummary = dashboard?.netOffSummary || [];
  const netOffMatrix = dashboard?.netOffMatrix || [];
  const netOffColumnTotals = dashboard?.netOffColumnTotals || {};

  const hasCompanyFilter = selectedCompanies.length > 0;
  const hasCpFilter = selectedCounterParties.length > 0;
  const hasTxnTypeFilter = selectedIcTxnTypes.length > 0;

  const filteredCompanyCodes = hasCompanyFilter
    ? companyCodes.filter((c: string) => selectedCompanies.includes(c))
    : companyCodes;
  const filteredCounterPartyCodes = hasCpFilter
    ? counterPartyCodes.filter((c: string) => selectedCounterParties.includes(c))
    : counterPartyCodes;

  const filteredMatrixData = matrixData.filter((row: any) =>
    !hasCompanyFilter || selectedCompanies.includes(row.companyCode)
  );
  const filteredNetOffMatrixData = netOffMatrix.filter((row: any) =>
    !hasCompanyFilter || selectedCompanies.includes(row.companyCode)
  );

  const filteredColumnTotals: Record<string, number> = {};
  for (const cp of filteredCounterPartyCodes) {
    let total = 0;
    for (const row of filteredMatrixData) total += row.balances[cp] || 0;
    filteredColumnTotals[cp] = total;
  }

  const filteredNetOffColumnTotals: Record<string, number> = {};
  for (const cp of filteredCounterPartyCodes) {
    let total = 0;
    for (const row of filteredNetOffMatrixData) total += row.balances[cp] || 0;
    filteredNetOffColumnTotals[cp] = total;
  }

  const filteredNetOffSummary = netOffSummary.filter((r: any) => {
    if (hasCompanyFilter && hasCpFilter) {
      return (
        (selectedCompanies.includes(r.companyCode) && selectedCounterParties.includes(r.counterPartyCode)) ||
        (selectedCompanies.includes(r.counterPartyCode) && selectedCounterParties.includes(r.companyCode))
      );
    }
    if (hasCompanyFilter) {
      return selectedCompanies.includes(r.companyCode) || selectedCompanies.includes(r.counterPartyCode);
    }
    if (hasCpFilter) {
      return selectedCounterParties.includes(r.companyCode) || selectedCounterParties.includes(r.counterPartyCode);
    }
    return true;
  });

  const pairColors = (() => {
    const palette = [
      "rgba(37,99,235,0.18)",
      "rgba(234,88,12,0.18)",
      "rgba(22,163,74,0.18)",
      "rgba(147,51,234,0.18)",
      "rgba(219,39,119,0.18)",
      "rgba(202,138,4,0.18)",
      "rgba(14,116,144,0.18)",
      "rgba(185,28,28,0.18)",
      "rgba(79,70,229,0.18)",
      "rgba(4,120,87,0.18)",
      "rgba(161,98,7,0.18)",
      "rgba(13,148,136,0.18)",
      "rgba(190,24,93,0.18)",
      "rgba(30,64,175,0.18)",
      "rgba(194,65,12,0.18)",
      "rgba(21,128,61,0.18)",
      "rgba(124,58,237,0.18)",
      "rgba(157,23,77,0.18)",
      "rgba(146,64,14,0.18)",
      "rgba(15,118,110,0.18)",
      "rgba(153,27,27,0.18)",
      "rgba(67,56,202,0.18)",
      "rgba(5,150,105,0.18)",
      "rgba(180,83,9,0.18)",
      "rgba(168,85,247,0.18)",
      "rgba(225,29,72,0.18)",
      "rgba(29,78,216,0.18)",
      "rgba(234,179,8,0.18)",
      "rgba(8,145,178,0.18)",
      "rgba(220,38,38,0.18)",
    ];
    const map: Record<string, string> = {};
    const allCodes = new Set([...companyCodes, ...counterPartyCodes]);
    const processed = new Set<string>();
    let colorIdx = 0;
    for (const cc of allCodes) {
      for (const cp of allCodes) {
        if (cc === cp) continue;
        const pairKey = [cc, cp].sort().join("|");
        if (processed.has(pairKey)) continue;
        const ccToCp = matrixData.find((r: any) => r.companyCode === cc)?.balances?.[cp] || 0;
        const cpToCc = matrixData.find((r: any) => r.companyCode === cp)?.balances?.[cc] || 0;
        if (ccToCp !== 0 || cpToCc !== 0) {
          const color = palette[colorIdx % palette.length];
          map[`${cc}|${cp}`] = color;
          map[`${cp}|${cc}`] = color;
          colorIdx++;
          processed.add(pairKey);
        }
      }
    }
    return map;
  })();

  const filteredNetOff = netOffSearch
    ? filteredNetOffSummary.filter((r: any) =>
        r.companyCode.toLowerCase().includes(netOffSearch.toLowerCase()) ||
        r.counterPartyCode.toLowerCase().includes(netOffSearch.toLowerCase())
      )
    : filteredNetOffSummary;

  return (
    <div className="p-6 space-y-6" data-testid="page-ic-matrix">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-ic-matrix-title">
            IC Matrix
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Intercompany balance matrix showing positions between entity pairs and net balances
          </p>
        </div>
        <div className="flex gap-2">
          {hasData && (
            <Button variant="outline" size="sm" onClick={handleDownload} data-testid="button-download">
              <Download className="w-4 h-4 mr-2" />
              {activeMatrixTab === "matrix" ? "Download Balance Matrix" :
               activeMatrixTab === "netoffmatrix" || activeMatrixTab === "netoff" ? "Download Net-off Matrix" :
               "Download Compiled TB"}
            </Button>
          )}
        </div>
      </div>

      {summary?.period && (
        <Card className="border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20">
          <CardContent className="py-3 px-4 flex items-center gap-2">
            <Badge variant="outline" className="text-blue-700 dark:text-blue-300 border-blue-300 dark:border-blue-700">
              Report Period
            </Badge>
            <span className="text-sm font-medium" data-testid="text-period">{summary.period}</span>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <Card data-testid="card-total-records" className="py-0">
          <CardContent className="p-3 flex items-center gap-2">
            <Table2 className="w-4 h-4 text-blue-500 shrink-0" />
            <div>
              <p className="text-[11px] text-muted-foreground leading-none">Total Records</p>
              <p className="text-lg font-bold leading-tight">{formatNum(summary?.totalRecords || 0)}</p>
            </div>
          </CardContent>
        </Card>
        <Card data-testid="card-ic-records" className="py-0">
          <CardContent className="p-3 flex items-center gap-2">
            <Grid3X3 className="w-4 h-4 text-indigo-500 shrink-0" />
            <div>
              <p className="text-[11px] text-muted-foreground leading-none">IC Records</p>
              <p className="text-lg font-bold leading-tight">{formatNum(dashboard?.totalIcRecords || 0)}</p>
            </div>
          </CardContent>
        </Card>
        <Card data-testid="card-tb-files" className="py-0">
          <CardContent className="p-3 flex items-center gap-2">
            <FileSpreadsheet className="w-4 h-4 text-green-500 shrink-0" />
            <div>
              <p className="text-[11px] text-muted-foreground leading-none">TB Files</p>
              <p className="text-lg font-bold leading-tight">{summary?.tbFiles || 0}</p>
            </div>
          </CardContent>
        </Card>
        <Card data-testid="card-gl-mappings" className="py-0">
          <CardContent className="p-3 flex items-center gap-2">
            <ArrowLeftRight className="w-4 h-4 text-orange-500 shrink-0" />
            <div>
              <p className="text-[11px] text-muted-foreground leading-none">GL Mappings</p>
              <p className="text-lg font-bold leading-tight">{formatNum(summary?.glMappings || 0)}</p>
            </div>
          </CardContent>
        </Card>
        <Card data-testid="card-net-off-mismatches" className="py-0">
          <CardContent className="p-3 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
            <div>
              <p className="text-[11px] text-muted-foreground leading-none">Net-off Mismatches</p>
              <p className="text-lg font-bold leading-tight text-red-600">{dashboard?.netOffCount || 0}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {!hasData ? (
        <Card className="border-dashed" data-testid="card-empty-state">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Grid3X3 className="w-12 h-12 text-muted-foreground/40 mb-4" />
            <h3 className="text-lg font-semibold mb-2">No Data Yet</h3>
            <p className="text-sm text-muted-foreground max-w-md mb-4">
              Upload Trial Balance files and the mapping file to compile the IC Matrix data.
            </p>
            <Link href="/ic-matrix/upload">
              <Button data-testid="button-go-upload">
                <FileSpreadsheet className="w-4 h-4 mr-2" />
                Go to Upload
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <Tabs defaultValue="matrix" value={activeMatrixTab} onValueChange={setActiveMatrixTab} className="space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <TabsList data-testid="tabs-dashboard">
              <TabsTrigger value="matrix" data-testid="tab-matrix">IC Balance Matrix</TabsTrigger>
              <TabsTrigger value="netoffmatrix" data-testid="tab-netoffmatrix">IC Net-off Matrix</TabsTrigger>
              <TabsTrigger value="netoff" data-testid="tab-netoff">
                IC Netoff Details
                {filteredNetOffSummary.length > 0 && (
                  <Badge variant="destructive" className="ml-2 text-[10px] px-1.5 py-0">
                    {filteredNetOffSummary.length}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="rawdata" data-testid="tab-rawdata">IC Data</TabsTrigger>
            </TabsList>
            <MultiSelectDropdown
              label="Companies"
              options={companyCodes}
              selected={selectedCompanies}
              onChange={(val) => { setSelectedCompanies(val); setPage(1); }}
              codeToName={codeToName}
              testId="filter-company"
            />
            <MultiSelectDropdown
              label="Counter Parties"
              options={counterPartyCodes}
              selected={selectedCounterParties}
              onChange={(val) => { setSelectedCounterParties(val); setPage(1); }}
              codeToName={codeToName}
              testId="filter-counterparty"
            />
            <MultiSelectDropdown
              label="IC Txn Type"
              options={icTxnTypes}
              selected={selectedIcTxnTypes}
              onChange={(val) => { setSelectedIcTxnTypes(val); setPage(1); }}
              codeToName={{}}
              testId="filter-ic-txn-type"
            />
            {(hasCompanyFilter || hasCpFilter || hasTxnTypeFilter) && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-xs text-muted-foreground"
                onClick={() => { setSelectedCompanies([]); setSelectedCounterParties([]); setSelectedIcTxnTypes([]); }}
                data-testid="button-clear-filters"
              >
                <X className="w-3 h-3 mr-1" />
                Clear
              </Button>
            )}
          </div>

          <TabsContent value="matrix" className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base" data-testid="text-matrix-title">IC Balance Matrix</CardTitle>
                    <p className="text-xs text-muted-foreground mt-1">
                      Company Codes (rows) × IC Counter Party Codes (columns) — Net Balance summarized
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <ChartFormatSettings chartId="ic-matrix" />
                    <Badge variant="secondary">
                      {filteredCompanyCodes.length} Companies × {filteredCounterPartyCodes.length} Counter Parties
                    </Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {dashLoading ? (
                  <div className="flex justify-center py-12 text-muted-foreground">Loading matrix...</div>
                ) : filteredMatrixData.length === 0 ? (
                  <div className="flex flex-col items-center py-12 text-muted-foreground">
                    <Grid3X3 className="w-8 h-8 mb-2 opacity-40" />
                    <p className="text-sm">No IC_ records found. Ensure GL mappings are applied.</p>
                  </div>
                ) : (
                  <div className="overflow-auto max-h-[65vh] border rounded-md" data-testid="table-matrix">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/50 sticky top-0 z-10">
                        <tr>
                          <th className="text-center p-2 font-semibold whitespace-nowrap sticky left-0 bg-muted/95 z-20 w-[40px]">
                            #
                          </th>
                          <th className="text-left p-2 font-semibold whitespace-nowrap sticky left-[40px] bg-muted/95 z-20 min-w-[140px]">
                            Company Code
                          </th>
                          {filteredCounterPartyCodes.map((cp: string, idx: number) => (
                            <th key={cp} className="text-right p-2 font-medium whitespace-nowrap min-w-[120px] cursor-help" title={codeToName[cp] || cp}>
                              <span className="block text-[10px] text-muted-foreground">{idx + 1}</span>
                              {cp}
                            </th>
                          ))}
                          <th className="text-right p-2 font-semibold whitespace-nowrap bg-muted/80 min-w-[120px]">
                            Row Total
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredMatrixData.map((row: any, rowIdx: number) => (
                          <tr key={row.companyCode} className="border-t hover:bg-muted/30">
                            <td className="p-2 text-center text-muted-foreground whitespace-nowrap sticky left-0 bg-background z-10">
                              {rowIdx + 1}
                            </td>
                            <td className="p-2 font-medium whitespace-nowrap sticky left-[40px] bg-background z-10 border-r cursor-help" title={codeToName[row.companyCode] || row.companyCode}>
                              {row.companyCode}
                            </td>
                            {filteredCounterPartyCodes.map((cp: string) => {
                              const val = row.balances[cp] || 0;
                              const bgColor = pairColors[`${row.companyCode}|${cp}`];
                              return (
                                <td
                                  key={cp}
                                  className={`p-2 text-right whitespace-nowrap ${
                                    val === 0
                                      ? "text-muted-foreground/40"
                                      : val < 0
                                      ? "text-red-600 dark:text-red-400"
                                      : "text-green-700 dark:text-green-400"
                                  }`}
                                  style={bgColor ? { backgroundColor: bgColor } : undefined}
                                  title={val !== 0 ? formatNum(val) : ""}
                                >
                                  {val === 0 ? "-" : formatAmount(val, matrixFmt)}
                                </td>
                              );
                            })}
                            <td className={`p-2 text-right whitespace-nowrap font-semibold bg-muted/30 ${
                              row.total < 0 ? "text-red-600" : row.total > 0 ? "text-green-700" : ""
                            }`}>
                              {formatAmount(hasCpFilter ? filteredCounterPartyCodes.reduce((s: number, cp: string) => s + (row.balances[cp] || 0), 0) : row.total, matrixFmt)}
                            </td>
                          </tr>
                        ))}
                        <tr className="border-t-2 bg-muted/40 font-semibold">
                          <td className="p-2 sticky left-0 bg-muted/80 z-10"></td>
                          <td className="p-2 sticky left-[40px] bg-muted/80 z-10 border-r">Column Total</td>
                          {filteredCounterPartyCodes.map((cp: string) => {
                            const val = filteredColumnTotals[cp] || 0;
                            return (
                              <td
                                key={cp}
                                className={`p-2 text-right whitespace-nowrap ${
                                  val < 0 ? "text-red-600" : val > 0 ? "text-green-700" : "text-muted-foreground/40"
                                }`}
                              >
                                {val === 0 ? "-" : formatAmount(val, matrixFmt)}
                              </td>
                            );
                          })}
                          <td className="p-2 text-right whitespace-nowrap bg-muted/60">
                            {formatAmount(Object.values(filteredColumnTotals).reduce((s: number, v: any) => s + (v || 0), 0), matrixFmt)}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="netoffmatrix" className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base" data-testid="text-netoff-matrix-title">IC Net-off Matrix</CardTitle>
                    <p className="text-xs text-muted-foreground mt-1">
                      After netting off matching A→B / B→A pairs, only residual balances remain
                    </p>
                  </div>
                  <Badge variant="secondary">
                    {filteredCompanyCodes.length} Companies × {filteredCounterPartyCodes.length} Counter Parties
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                {dashLoading ? (
                  <div className="flex justify-center py-12 text-muted-foreground">Loading matrix...</div>
                ) : filteredNetOffMatrixData.length === 0 ? (
                  <div className="flex flex-col items-center py-12 text-muted-foreground">
                    <Grid3X3 className="w-8 h-8 mb-2 opacity-40" />
                    <p className="text-sm">No IC_ records found. Ensure GL mappings are applied.</p>
                  </div>
                ) : (
                  <div className="overflow-auto max-h-[65vh] border rounded-md" data-testid="table-netoff-matrix">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/50 sticky top-0 z-10">
                        <tr>
                          <th className="text-center p-2 font-semibold whitespace-nowrap sticky left-0 bg-muted/95 z-20 w-[40px]">
                            #
                          </th>
                          <th className="text-left p-2 font-semibold whitespace-nowrap sticky left-[40px] bg-muted/95 z-20 min-w-[140px]">
                            Company Code
                          </th>
                          {filteredCounterPartyCodes.map((cp: string, idx: number) => (
                            <th key={cp} className="text-right p-2 font-medium whitespace-nowrap min-w-[120px] cursor-help" title={codeToName[cp] || cp}>
                              <span className="block text-[10px] text-muted-foreground">{idx + 1}</span>
                              {cp}
                            </th>
                          ))}
                          <th className="text-right p-2 font-semibold whitespace-nowrap bg-muted/80 min-w-[120px]">
                            Row Total
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredNetOffMatrixData.map((row: any, rowIdx: number) => (
                          <tr key={row.companyCode} className="border-t hover:bg-muted/30">
                            <td className="p-2 text-center text-muted-foreground whitespace-nowrap sticky left-0 bg-background z-10">
                              {rowIdx + 1}
                            </td>
                            <td className="p-2 font-medium whitespace-nowrap sticky left-[40px] bg-background z-10 border-r cursor-help" title={codeToName[row.companyCode] || row.companyCode}>
                              {row.companyCode}
                            </td>
                            {filteredCounterPartyCodes.map((cp: string) => {
                              const val = row.balances[cp] || 0;
                              const bgColor = pairColors[`${row.companyCode}|${cp}`];
                              return (
                                <td
                                  key={cp}
                                  className={`p-2 text-right whitespace-nowrap ${
                                    val === 0
                                      ? "text-muted-foreground/40"
                                      : val < 0
                                      ? "text-red-600 dark:text-red-400"
                                      : "text-green-700 dark:text-green-400"
                                  }`}
                                  style={bgColor ? { backgroundColor: bgColor } : undefined}
                                  title={val !== 0 ? formatNum(val) : ""}
                                >
                                  {val === 0 ? "-" : formatAmount(val, matrixFmt)}
                                </td>
                              );
                            })}
                            <td className={`p-2 text-right whitespace-nowrap font-semibold bg-muted/30 ${
                              row.total < 0 ? "text-red-600" : row.total > 0 ? "text-green-700" : ""
                            }`}>
                              {formatAmount(hasCpFilter ? filteredCounterPartyCodes.reduce((s: number, cp: string) => s + (row.balances[cp] || 0), 0) : row.total, matrixFmt)}
                            </td>
                          </tr>
                        ))}
                        <tr className="border-t-2 bg-muted/40 font-semibold">
                          <td className="p-2 sticky left-0 bg-muted/80 z-10"></td>
                          <td className="p-2 sticky left-[40px] bg-muted/80 z-10 border-r">Column Total</td>
                          {filteredCounterPartyCodes.map((cp: string) => {
                            const val = filteredNetOffColumnTotals[cp] || 0;
                            return (
                              <td
                                key={cp}
                                className={`p-2 text-right whitespace-nowrap ${
                                  val < 0 ? "text-red-600" : val > 0 ? "text-green-700" : "text-muted-foreground/40"
                                }`}
                              >
                                {val === 0 ? "-" : formatAmount(val, matrixFmt)}
                              </td>
                            );
                          })}
                          <td className="p-2 text-right whitespace-nowrap bg-muted/60">
                            {formatAmount(Object.values(filteredNetOffColumnTotals).reduce((s: number, v: any) => s + (v || 0), 0), matrixFmt)}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="netoff" className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base" data-testid="text-netoff-title">IC Netoff Details</CardTitle>
                    <p className="text-xs text-muted-foreground mt-1">
                      Pairs where Company→Counter Party balance does not match Counter Party→Company balance
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge variant={filteredNetOffSummary.length > 0 ? "destructive" : "default"}>
                      {filteredNetOffSummary.length} Mismatch{filteredNetOffSummary.length !== 1 ? "es" : ""}
                    </Badge>
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                      <Input
                        placeholder="Filter pairs..."
                        value={netOffSearch}
                        onChange={(e) => setNetOffSearch(e.target.value)}
                        className="pl-8 h-8 w-48 text-xs"
                        data-testid="input-netoff-search"
                      />
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {dashLoading ? (
                  <div className="flex justify-center py-12 text-muted-foreground">Loading...</div>
                ) : filteredNetOffSummary.length === 0 ? (
                  <div className="flex flex-col items-center py-12 text-muted-foreground">
                    <CheckCircle className="w-8 h-8 mb-2 text-green-500" />
                    <p className="text-sm font-medium">All intercompany balances are matched!</p>
                    <p className="text-xs mt-1">No net-off differences found.</p>
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
                      <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg p-3">
                        <p className="text-xs text-red-600 dark:text-red-400 font-medium">Total Absolute Difference</p>
                        <p className="text-lg font-bold text-red-700 dark:text-red-300" data-testid="text-total-diff">
                          {formatAmount(filteredNetOffSummary.reduce((s: number, r: any) => s + Math.abs(r.difference), 0), netoffDetailFmt)}
                        </p>
                      </div>
                      <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
                        <p className="text-xs text-amber-600 dark:text-amber-400 font-medium">Mismatched Pairs</p>
                        <p className="text-lg font-bold text-amber-700 dark:text-amber-300" data-testid="text-mismatch-count">
                          {filteredNetOffSummary.length}
                        </p>
                      </div>
                      <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
                        <p className="text-xs text-blue-600 dark:text-blue-400 font-medium">Largest Mismatch</p>
                        <p className="text-lg font-bold text-blue-700 dark:text-blue-300" data-testid="text-largest-diff">
                          {filteredNetOffSummary.length > 0 ? formatAmount(Math.abs(filteredNetOffSummary[0].difference), netoffDetailFmt) : "0"}
                        </p>
                      </div>
                    </div>
                    <div className="overflow-auto max-h-[55vh] border rounded-md" data-testid="table-netoff">
                      <table className="w-full text-xs">
                        <thead className="bg-muted/50 sticky top-0">
                          <tr>
                            <th className="text-left p-2 font-medium whitespace-nowrap">#</th>
                            <th className="text-left p-2 font-medium whitespace-nowrap">Company Code</th>
                            <th className="text-left p-2 font-medium whitespace-nowrap">Counter Party Code</th>
                            <th className="text-right p-2 font-medium whitespace-nowrap">Company → CP Balance</th>
                            <th className="text-right p-2 font-medium whitespace-nowrap">CP → Company Balance</th>
                            <th className="text-right p-2 font-medium whitespace-nowrap">Difference</th>
                            <th className="text-center p-2 font-medium whitespace-nowrap">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredNetOff.map((row: any, i: number) => (
                            <tr key={`${row.companyCode}-${row.counterPartyCode}`} className="border-t hover:bg-muted/30">
                              <td className="p-2 text-muted-foreground">{i + 1}</td>
                              <td className="p-2 font-medium whitespace-nowrap cursor-help" title={codeToName[row.companyCode] || row.companyCode}>{row.companyCode}</td>
                              <td className="p-2 font-medium whitespace-nowrap cursor-help" title={codeToName[row.counterPartyCode] || row.counterPartyCode}>{row.counterPartyCode}</td>
                              <td className={`p-2 text-right whitespace-nowrap ${
                                row.companyBalance < 0 ? "text-red-600" : row.companyBalance > 0 ? "text-green-700" : ""
                              }`}>
                                {formatAmount(row.companyBalance, netoffDetailFmt)}
                              </td>
                              <td className={`p-2 text-right whitespace-nowrap ${
                                row.counterPartyBalance < 0 ? "text-red-600" : row.counterPartyBalance > 0 ? "text-green-700" : ""
                              }`}>
                                {formatAmount(row.counterPartyBalance, netoffDetailFmt)}
                              </td>
                              <td className={`p-2 text-right whitespace-nowrap font-semibold ${
                                row.difference < 0 ? "text-red-600" : "text-red-600"
                              }`}>
                                {formatAmount(row.difference, netoffDetailFmt)}
                              </td>
                              <td className="p-2 text-center">
                                <Badge variant="destructive" className="text-[10px] px-1.5">
                                  Mismatch
                                </Badge>
                              </td>
                            </tr>
                          ))}
                          {filteredNetOff.length === 0 && (
                            <tr>
                              <td colSpan={7} className="text-center p-8 text-muted-foreground">
                                No matching pairs found
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="rawdata" className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Compiled Trial Balance Data</CardTitle>
                  <div className="flex items-center gap-3">
                    {summary?.files && summary.files.length > 0 && (
                      <Select value={selectedTbFile} onValueChange={(v) => { setSelectedTbFile(v); setPage(1); }}>
                        <SelectTrigger className="w-40 h-8 text-xs" data-testid="select-tb-filter">
                          <SelectValue placeholder="All TB Files" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All TB Files</SelectItem>
                          {summary.files.map((f: any) => (
                            <SelectItem key={f.id} value={String(f.id)}>{f.enterprise || f.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                      <Input
                        placeholder="Search..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="pl-8 h-8 w-52 text-xs"
                        data-testid="input-search"
                      />
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="overflow-auto max-h-[60vh] border rounded-md">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50 sticky top-0">
                      <tr>
                        <th className="text-left p-2 font-medium whitespace-nowrap">Company</th>
                        <th className="text-left p-2 font-medium whitespace-nowrap">Company Code</th>
                        <th className="text-left p-2 font-medium whitespace-nowrap">Account Head</th>
                        <th className="text-left p-2 font-medium whitespace-nowrap">Sub Account Head</th>
                        <th className="text-right p-2 font-medium whitespace-nowrap">Closing Debit</th>
                        <th className="text-right p-2 font-medium whitespace-nowrap">Closing Credit</th>
                        <th className="text-right p-2 font-medium whitespace-nowrap">Net Balance</th>
                        <th className="text-left p-2 font-medium whitespace-nowrap">New COA GL Name</th>
                        <th className="text-left p-2 font-medium whitespace-nowrap">IC Counter Party</th>
                        <th className="text-left p-2 font-medium whitespace-nowrap">IC CP Code</th>
                        <th className="text-left p-2 font-medium whitespace-nowrap">IC Txn Type</th>
                        <th className="text-left p-2 font-medium whitespace-nowrap">TB Source</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredData.map((row: any) => (
                        <tr key={row.id} className="border-t hover:bg-muted/30">
                          <td className="p-2 max-w-[200px] truncate" title={row.company}>{row.company}</td>
                          <td className="p-2 whitespace-nowrap">{row.companyCode || "-"}</td>
                          <td className="p-2 max-w-[180px] truncate" title={row.accountHead}>{row.accountHead || "-"}</td>
                          <td className="p-2 max-w-[180px] truncate" title={row.subAccountHead}>{row.subAccountHead || "-"}</td>
                          <td className="p-2 text-right whitespace-nowrap">{formatNum(row.closingDebit)}</td>
                          <td className="p-2 text-right whitespace-nowrap">{formatNum(row.closingCredit)}</td>
                          <td className={`p-2 text-right whitespace-nowrap font-medium ${(row.netBalance || 0) < 0 ? "text-red-600" : ""}`}>
                            {formatNum(row.netBalance)}
                          </td>
                          <td className="p-2 max-w-[180px] truncate" title={row.newCoaGlName}>{row.newCoaGlName || "-"}</td>
                          <td className="p-2 max-w-[150px] truncate" title={row.icCounterParty}>{row.icCounterParty || "-"}</td>
                          <td className="p-2 whitespace-nowrap">{row.icCounterPartyCode || "-"}</td>
                          <td className="p-2 whitespace-nowrap">{row.icTxnType || "-"}</td>
                          <td className="p-2 max-w-[180px] truncate" title={row.tbSource}>{row.tbSource || "-"}</td>
                        </tr>
                      ))}
                      {filteredData.length === 0 && (
                        <tr>
                          <td colSpan={12} className="text-center p-8 text-muted-foreground">
                            {dataLoading ? "Loading..." : "No records found"}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="flex items-center justify-between mt-3">
                  <p className="text-xs text-muted-foreground">
                    Showing {((page - 1) * limit) + 1} to {Math.min(page * limit, total)} of {formatNum(total)} records
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page <= 1}
                      onClick={() => setPage(p => p - 1)}
                      data-testid="button-prev-page"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </Button>
                    <span className="text-xs">Page {page} of {totalPages}</span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page >= totalPages}
                      onClick={() => setPage(p => p + 1)}
                      data-testid="button-next-page"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
