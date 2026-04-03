import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AlertTriangle, Download, Save, RefreshCw, FileDown } from "lucide-react";
import { useState, useCallback } from "react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useDashboardSettings } from "@/hooks/use-dashboard-settings";
import { formatAmount } from "@/lib/number-format";

interface UnmappedGLItem {
  id: number;
  accountHead: string;
  group1: string;
  group2: string;
  group3: string;
  group4: string;
  group5: string;
  cashflow: string;
  cfHead: string;
  activityType: string;
  cfStatementLine: string;
  plCategory: string;
  plSign: number;
  wipComponent: string;
  wcBucket: string;
  wcSign: number;
  debtBucket: string;
  kpiTag: string;
  netClosingBalance: number;
  rowCount: number;
}

interface UnmappedEntityItem {
  id: number;
  company: string;
  businessUnit: string;
  structure: string;
  projectName: string;
  entityStatus: string;
  remarks: string;
  netClosingBalance: number;
  rowCount: number;
}

interface UnmappedResponse {
  unmappedGLs: {
    count: number;
    items: UnmappedGLItem[];
  };
  unmappedEntities: {
    count: number;
    items: UnmappedEntityItem[];
  };
}

export default function CashflowUnmapped() {
  const { toast } = useToast();
  const { getFormat } = useDashboardSettings();
  const cfFmt = getFormat("cf-amounts");

  const { data: unmappedResult, isLoading: loadingUnmapped } = useQuery<UnmappedResponse>({
    queryKey: ["/api/cashflow/unmapped-items"],
  });

  const [glEdits, setGlEdits] = useState<Record<string, Partial<UnmappedGLItem>>>({});
  const [entityEdits, setEntityEdits] = useState<Record<string, Partial<UnmappedEntityItem>>>({});
  const [savingGLs, setSavingGLs] = useState(false);
  const [savingEntities, setSavingEntities] = useState(false);

  const updateGLField = useCallback((accountHead: string, field: string, value: string | number) => {
    setGlEdits(prev => ({
      ...prev,
      [accountHead]: { ...prev[accountHead], [field]: value },
    }));
  }, []);

  const updateEntityField = useCallback((company: string, field: string, value: string) => {
    setEntityEdits(prev => ({
      ...prev,
      [company]: { ...prev[company], [field]: value },
    }));
  }, []);

  const getGLValue = useCallback((item: UnmappedGLItem, field: keyof UnmappedGLItem) => {
    const edit = glEdits[item.accountHead];
    if (edit && field in edit) return edit[field as keyof typeof edit];
    return item[field];
  }, [glEdits]);

  const getEntityValue = useCallback((item: UnmappedEntityItem, field: keyof UnmappedEntityItem) => {
    const edit = entityEdits[item.company];
    if (edit && field in edit) return edit[field as keyof typeof edit];
    return item[field];
  }, [entityEdits]);

  const hasGLEdits = Object.keys(glEdits).length > 0;
  const hasEntityEdits = Object.keys(entityEdits).length > 0;

  const saveGLMappings = async () => {
    const updates = Object.entries(glEdits).map(([accountHead, edits]) => {
      const original = unmappedResult?.unmappedGLs?.items?.find(i => i.accountHead === accountHead);
      return {
        accountHead,
        cashflow: edits.cashflow ?? original?.cashflow ?? "",
        cfHead: edits.cfHead ?? original?.cfHead ?? "",
        activityType: edits.activityType ?? original?.activityType ?? "",
        cfStatementLine: edits.cfStatementLine ?? original?.cfStatementLine ?? "",
        plCategory: edits.plCategory ?? original?.plCategory ?? "",
        plSign: edits.plSign != null ? Number(edits.plSign) : (original?.plSign ?? 0),
        wipComponent: edits.wipComponent ?? original?.wipComponent ?? "",
        wcBucket: edits.wcBucket ?? original?.wcBucket ?? "",
        wcSign: edits.wcSign != null ? Number(edits.wcSign) : (original?.wcSign ?? 0),
        debtBucket: edits.debtBucket ?? original?.debtBucket ?? "",
        kpiTag: edits.kpiTag ?? original?.kpiTag ?? "",
      };
    });
    setSavingGLs(true);
    try {
      await apiRequest("POST", "/api/cashflow/update-gl-mapping", { updates });
      setGlEdits({});
      toast({ title: "GL mappings saved", description: `${updates.length} mapping(s) updated` });
      queryClient.invalidateQueries({ queryKey: ["/api/cashflow/unmapped-items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cashflow/mapping-summary"] });
    } catch (e: any) {
      toast({ title: "Error saving GL mappings", description: e.message, variant: "destructive" });
    } finally {
      setSavingGLs(false);
    }
  };

  const saveEntityMappings = async () => {
    const updates = Object.entries(entityEdits).map(([company, edits]) => {
      const original = unmappedResult?.unmappedEntities?.items?.find(i => i.company === company);
      return {
        company,
        businessUnit: original?.businessUnit ?? "",
        structure: edits.structure ?? original?.structure ?? "",
        projectName: edits.projectName ?? original?.projectName ?? "",
        entityStatus: edits.entityStatus ?? original?.entityStatus ?? "",
        remarks: edits.remarks ?? original?.remarks ?? "",
      };
    });
    setSavingEntities(true);
    try {
      await apiRequest("POST", "/api/cashflow/update-entity-mapping", { updates });
      setEntityEdits({});
      toast({ title: "Entity mappings saved", description: `${updates.length} mapping(s) updated` });
      queryClient.invalidateQueries({ queryKey: ["/api/cashflow/unmapped-items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cashflow/mapping-summary"] });
    } catch (e: any) {
      toast({ title: "Error saving entity mappings", description: e.message, variant: "destructive" });
    } finally {
      setSavingEntities(false);
    }
  };

  const reprocessAfterSave = async () => {
    try {
      await apiRequest("POST", "/api/cashflow/reprocess");
      toast({ title: "Reprocessing complete", description: "TB data has been reprocessed with updated mappings" });
      queryClient.invalidateQueries({ queryKey: ["/api/cashflow/unmapped-items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cashflow/unified-data"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cashflow/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cashflow/dashboard-data"] });
    } catch (e: any) {
      toast({ title: "Reprocess failed", description: e.message, variant: "destructive" });
    }
  };

  const unmappedGLCount = unmappedResult?.unmappedGLs?.count || 0;
  const unmappedEntityCount = unmappedResult?.unmappedEntities?.count || 0;

  if (loadingUnmapped) {
    return (
      <div className="p-6 space-y-6" data-testid="page-cashflow-unmapped">
        <h1 className="text-2xl font-bold tracking-tight">Unmapped Items</h1>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6" data-testid="page-cashflow-unmapped">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Unmapped Items</h1>
          <p className="text-muted-foreground text-sm mt-1">GL and Entity mappings that need attention</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-amber-600 border-amber-300">
            {unmappedGLCount} unmapped GL rows
          </Badge>
          <Badge variant="outline" className="text-amber-600 border-amber-300">
            {unmappedEntityCount} unmapped entity rows
          </Badge>
        </div>
      </div>

      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" size="sm" onClick={() => window.open("/api/cashflow/download-unmapped", "_blank")} data-testid="button-download-unmapped">
          <Download className="w-4 h-4 mr-1" />
          Download Unmapped
        </Button>
        <Button variant="outline" size="sm" onClick={() => window.open("/api/cashflow/download-mapping", "_blank")} data-testid="button-download-mapping">
          <FileDown className="w-4 h-4 mr-1" />
          Download Mapping File
        </Button>
        {(hasGLEdits || hasEntityEdits) && (
          <Button size="sm" variant="default" onClick={reprocessAfterSave} data-testid="button-reprocess-unmapped">
            <RefreshCw className="w-4 h-4 mr-1" />
            Reprocess TB
          </Button>
        )}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              Unmapped GLs — Account Head Mapping
            </CardTitle>
            <div className="flex items-center gap-2">
              {hasGLEdits && (
                <Badge variant="secondary" className="bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300">
                  {Object.keys(glEdits).length} edited
                </Badge>
              )}
              <Button
                size="sm"
                disabled={!hasGLEdits || savingGLs}
                onClick={saveGLMappings}
                data-testid="button-save-gl-mappings"
              >
                <Save className="w-4 h-4 mr-1" />
                {savingGLs ? "Saving..." : "Save GL Mappings"}
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            TB lines where Cashflow or CF Head is blank. Edit cells below to update the mapping directly.
          </p>
        </CardHeader>
        <CardContent>
          {unmappedGLCount === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground" data-testid="text-all-gl-mapped">All GL items are mapped</div>
          ) : (
            <div className="overflow-auto max-h-[500px] border rounded-md">
              <Table>
                <TableHeader className="sticky top-0 bg-muted z-10">
                  <TableRow>
                    <TableHead className="min-w-[200px]">Account Head</TableHead>
                    <TableHead className="min-w-[100px]">Group 1</TableHead>
                    <TableHead className="min-w-[100px]">Group 2</TableHead>
                    <TableHead className="min-w-[100px]">Group 3</TableHead>
                    <TableHead className="text-right min-w-[120px]">Net Balance</TableHead>
                    <TableHead className="text-right min-w-[60px]">Rows</TableHead>
                    <TableHead className="min-w-[120px] bg-green-50 dark:bg-green-950">Cashflow</TableHead>
                    <TableHead className="min-w-[150px] bg-green-50 dark:bg-green-950">CF Head</TableHead>
                    <TableHead className="min-w-[120px] bg-green-50 dark:bg-green-950">Activity Type</TableHead>
                    <TableHead className="min-w-[150px] bg-green-50 dark:bg-green-950">CF Statement Line</TableHead>
                    <TableHead className="min-w-[120px] bg-green-50 dark:bg-green-950">P&L Category</TableHead>
                    <TableHead className="min-w-[80px] bg-green-50 dark:bg-green-950">P&L Sign</TableHead>
                    <TableHead className="min-w-[120px] bg-green-50 dark:bg-green-950">WIP Component</TableHead>
                    <TableHead className="min-w-[120px] bg-green-50 dark:bg-green-950">WC Bucket</TableHead>
                    <TableHead className="min-w-[80px] bg-green-50 dark:bg-green-950">WC Sign</TableHead>
                    <TableHead className="min-w-[120px] bg-green-50 dark:bg-green-950">Debt Bucket</TableHead>
                    <TableHead className="min-w-[100px] bg-green-50 dark:bg-green-950">KPI Tag</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {unmappedResult?.unmappedGLs?.items?.map((item) => (
                    <TableRow key={item.id} data-testid={`unmapped-gl-${item.id}`} className={glEdits[item.accountHead] ? "bg-blue-50/50 dark:bg-blue-950/30" : ""}>
                      <TableCell className="text-xs font-medium">{item.accountHead}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{item.group1}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{item.group2}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{item.group3}</TableCell>
                      <TableCell className={`text-right text-xs font-mono ${(item.netClosingBalance || 0) < 0 ? "text-red-600" : "text-green-600"}`}>
                        ₹{formatAmount(item.netClosingBalance || 0, cfFmt)}
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">{item.rowCount}</TableCell>
                      <TableCell className="p-1 bg-green-50/50 dark:bg-green-950/30">
                        <Input className="h-7 text-xs" value={String(getGLValue(item, "cashflow") || "")} onChange={(e) => updateGLField(item.accountHead, "cashflow", e.target.value)} data-testid={`input-gl-cashflow-${item.id}`} />
                      </TableCell>
                      <TableCell className="p-1 bg-green-50/50 dark:bg-green-950/30">
                        <Input className="h-7 text-xs" value={String(getGLValue(item, "cfHead") || "")} onChange={(e) => updateGLField(item.accountHead, "cfHead", e.target.value)} data-testid={`input-gl-cfhead-${item.id}`} />
                      </TableCell>
                      <TableCell className="p-1 bg-green-50/50 dark:bg-green-950/30">
                        <Input className="h-7 text-xs" value={String(getGLValue(item, "activityType") || "")} onChange={(e) => updateGLField(item.accountHead, "activityType", e.target.value)} data-testid={`input-gl-activity-${item.id}`} />
                      </TableCell>
                      <TableCell className="p-1 bg-green-50/50 dark:bg-green-950/30">
                        <Input className="h-7 text-xs" value={String(getGLValue(item, "cfStatementLine") || "")} onChange={(e) => updateGLField(item.accountHead, "cfStatementLine", e.target.value)} data-testid={`input-gl-cfline-${item.id}`} />
                      </TableCell>
                      <TableCell className="p-1 bg-green-50/50 dark:bg-green-950/30">
                        <Input className="h-7 text-xs" value={String(getGLValue(item, "plCategory") || "")} onChange={(e) => updateGLField(item.accountHead, "plCategory", e.target.value)} data-testid={`input-gl-plcat-${item.id}`} />
                      </TableCell>
                      <TableCell className="p-1 bg-green-50/50 dark:bg-green-950/30">
                        <Input className="h-7 text-xs w-16" type="number" value={String(getGLValue(item, "plSign") ?? 0)} onChange={(e) => updateGLField(item.accountHead, "plSign", parseFloat(e.target.value) || 0)} data-testid={`input-gl-plsign-${item.id}`} />
                      </TableCell>
                      <TableCell className="p-1 bg-green-50/50 dark:bg-green-950/30">
                        <Input className="h-7 text-xs" value={String(getGLValue(item, "wipComponent") || "")} onChange={(e) => updateGLField(item.accountHead, "wipComponent", e.target.value)} data-testid={`input-gl-wip-${item.id}`} />
                      </TableCell>
                      <TableCell className="p-1 bg-green-50/50 dark:bg-green-950/30">
                        <Input className="h-7 text-xs" value={String(getGLValue(item, "wcBucket") || "")} onChange={(e) => updateGLField(item.accountHead, "wcBucket", e.target.value)} data-testid={`input-gl-wcbucket-${item.id}`} />
                      </TableCell>
                      <TableCell className="p-1 bg-green-50/50 dark:bg-green-950/30">
                        <Input className="h-7 text-xs w-16" type="number" value={String(getGLValue(item, "wcSign") ?? 0)} onChange={(e) => updateGLField(item.accountHead, "wcSign", parseFloat(e.target.value) || 0)} data-testid={`input-gl-wcsign-${item.id}`} />
                      </TableCell>
                      <TableCell className="p-1 bg-green-50/50 dark:bg-green-950/30">
                        <Input className="h-7 text-xs" value={String(getGLValue(item, "debtBucket") || "")} onChange={(e) => updateGLField(item.accountHead, "debtBucket", e.target.value)} data-testid={`input-gl-debt-${item.id}`} />
                      </TableCell>
                      <TableCell className="p-1 bg-green-50/50 dark:bg-green-950/30">
                        <Input className="h-7 text-xs" value={String(getGLValue(item, "kpiTag") || "")} onChange={(e) => updateGLField(item.accountHead, "kpiTag", e.target.value)} data-testid={`input-gl-kpi-${item.id}`} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              Unmapped Entities — Company Mapping
            </CardTitle>
            <div className="flex items-center gap-2">
              {hasEntityEdits && (
                <Badge variant="secondary" className="bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300">
                  {Object.keys(entityEdits).length} edited
                </Badge>
              )}
              <Button
                size="sm"
                disabled={!hasEntityEdits || savingEntities}
                onClick={saveEntityMappings}
                data-testid="button-save-entity-mappings"
              >
                <Save className="w-4 h-4 mr-1" />
                {savingEntities ? "Saving..." : "Save Entity Mappings"}
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            TB lines where Project or Entity Status is blank. Edit cells below to update the mapping directly.
          </p>
        </CardHeader>
        <CardContent>
          {unmappedEntityCount === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground" data-testid="text-all-entity-mapped">All entities are mapped</div>
          ) : (
            <div className="overflow-auto max-h-[400px] border rounded-md">
              <Table>
                <TableHeader className="sticky top-0 bg-muted z-10">
                  <TableRow>
                    <TableHead className="min-w-[200px]">Company</TableHead>
                    <TableHead className="min-w-[120px]">Business Unit</TableHead>
                    <TableHead className="text-right min-w-[120px]">Net Balance</TableHead>
                    <TableHead className="text-right min-w-[60px]">Rows</TableHead>
                    <TableHead className="min-w-[150px] bg-green-50 dark:bg-green-950">Structure</TableHead>
                    <TableHead className="min-w-[200px] bg-green-50 dark:bg-green-950">Project Name</TableHead>
                    <TableHead className="min-w-[130px] bg-green-50 dark:bg-green-950">Entity Status</TableHead>
                    <TableHead className="min-w-[150px] bg-green-50 dark:bg-green-950">Remarks</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {unmappedResult?.unmappedEntities?.items?.map((item) => (
                    <TableRow key={item.id} data-testid={`unmapped-entity-${item.id}`} className={entityEdits[item.company] ? "bg-blue-50/50 dark:bg-blue-950/30" : ""}>
                      <TableCell className="text-xs font-medium">{item.company}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{item.businessUnit}</TableCell>
                      <TableCell className={`text-right text-xs font-mono ${(item.netClosingBalance || 0) < 0 ? "text-red-600" : "text-green-600"}`}>
                        ₹{formatAmount(item.netClosingBalance || 0, cfFmt)}
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">{item.rowCount}</TableCell>
                      <TableCell className="p-1 bg-green-50/50 dark:bg-green-950/30">
                        <Input className="h-7 text-xs" value={String(getEntityValue(item, "structure") || "")} onChange={(e) => updateEntityField(item.company, "structure", e.target.value)} data-testid={`input-entity-structure-${item.id}`} />
                      </TableCell>
                      <TableCell className="p-1 bg-green-50/50 dark:bg-green-950/30">
                        <Input className="h-7 text-xs" value={String(getEntityValue(item, "projectName") || "")} onChange={(e) => updateEntityField(item.company, "projectName", e.target.value)} data-testid={`input-entity-project-${item.id}`} />
                      </TableCell>
                      <TableCell className="p-1 bg-green-50/50 dark:bg-green-950/30">
                        <Input className="h-7 text-xs" value={String(getEntityValue(item, "entityStatus") || "")} onChange={(e) => updateEntityField(item.company, "entityStatus", e.target.value)} data-testid={`input-entity-status-${item.id}`} />
                      </TableCell>
                      <TableCell className="p-1 bg-green-50/50 dark:bg-green-950/30">
                        <Input className="h-7 text-xs" value={String(getEntityValue(item, "remarks") || "")} onChange={(e) => updateEntityField(item.company, "remarks", e.target.value)} data-testid={`input-entity-remarks-${item.id}`} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
