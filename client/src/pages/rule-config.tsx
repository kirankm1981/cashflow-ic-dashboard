import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import {
  Settings2,
  Plus,
  Pencil,
  Trash2,
  GripVertical,
  Loader2,
  RotateCcw,
} from "lucide-react";
import type { Rule } from "@shared/schema";

const RULE_TYPES = [
  { value: "invoice_match", label: "Invoice/Reference Match" },
  { value: "exact_match", label: "Exact Date + Amount (1:1)" },
  { value: "date_range_match", label: "Date Range + Amount (1:1)" },
  { value: "exact_aggregation", label: "Aggregation - Same Date (1:M / M:M)" },
  { value: "date_range_aggregation", label: "Aggregation - Date Range (1:M / M:M)" },
  { value: "reversal_match", label: "Reversal Transactions" },
  { value: "amount_only_match", label: "Amount Only Match (1:1)" },
  { value: "fuzzy_narration_match", label: "Fuzzy Narration Match" },
  { value: "amount_only_aggregation", label: "Aggregated Amount Only (1:M / M:M)" },
  { value: "combined_scoring", label: "Combined Scoring" },
];

const CLASSIFICATIONS = [
  { value: "AUTO_MATCH", label: "Auto Match (High Confidence)" },
  { value: "REVERSAL", label: "Reversal" },
  { value: "REVIEW_MATCH", label: "Review Match (Needs Review)" },
  { value: "SUGGESTED_MATCH", label: "Suggested Match (Low Confidence)" },
];

const MATCH_TYPES = [
  { value: "1:1", label: "1:1 (One-to-One)" },
  { value: "1:M", label: "1:M / M:M (Aggregation)" },
];

const CLASSIFICATION_COLORS: Record<string, string> = {
  AUTO_MATCH: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  REVERSAL: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  REVIEW_MATCH: "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400",
  SUGGESTED_MATCH: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
};

function RuleForm({
  rule,
  onSubmit,
  isPending,
  onClose,
}: {
  rule?: Rule;
  onSubmit: (data: any) => void;
  isPending: boolean;
  onClose: () => void;
}) {
  const [name, setName] = useState(rule?.name || "");
  const [ruleId, setRuleId] = useState(rule?.ruleId || "");
  const [ruleType, setRuleType] = useState(rule?.ruleType || "exact_match");
  const [matchType, setMatchType] = useState(rule?.matchType || "1:1");
  const [priority, setPriority] = useState(rule?.priority?.toString() || "1");
  const [dateTolerance, setDateTolerance] = useState(rule?.dateTolerance?.toString() || "");
  const [amountTolerance, setAmountTolerance] = useState(rule?.amountTolerance?.toString() || "5");
  const [amountTolerancePct, setAmountTolerancePct] = useState(rule?.amountTolerancePct?.toString() || "0");
  const [classification, setClassification] = useState(rule?.classification || "AUTO_MATCH");
  const [active, setActive] = useState(rule?.active ?? true);
  const [description, setDescription] = useState(rule?.description || "");
  const [params, setParams] = useState(rule?.params || "");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      name,
      ruleId: ruleId || `IC-R${priority}`,
      ruleType,
      matchType,
      priority: parseInt(priority),
      dateTolerance: dateTolerance ? parseFloat(dateTolerance) : null,
      amountTolerance: amountTolerance ? parseFloat(amountTolerance) : 0,
      amountTolerancePct: amountTolerancePct ? parseFloat(amountTolerancePct) : 0,
      confidence: classification === "AUTO_MATCH" || classification === "REVERSAL" ? "real_match" : classification === "REVIEW_MATCH" ? "probable_match" : "suggestion",
      classification,
      active,
      description: description || null,
      params: params || null,
    });
  };

  const needsDateTolerance = ["date_range_match", "date_range_aggregation", "reversal_match"].includes(ruleType);

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="ruleId">Rule ID</Label>
          <Input
            id="ruleId"
            value={ruleId}
            onChange={(e) => setRuleId(e.target.value)}
            placeholder="IC-R1"
            data-testid="input-rule-id"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="name">Rule Name</Label>
          <Input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            data-testid="input-rule-name"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="ruleType">Rule Type</Label>
          <Select value={ruleType} onValueChange={setRuleType}>
            <SelectTrigger data-testid="select-rule-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RULE_TYPES.map((rt) => (
                <SelectItem key={rt.value} value={rt.value}>{rt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="matchType">Match Type</Label>
          <Select value={matchType} onValueChange={setMatchType}>
            <SelectTrigger data-testid="select-match-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MATCH_TYPES.map((mt) => (
                <SelectItem key={mt.value} value={mt.value}>{mt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-2">
          <Label htmlFor="priority">Priority</Label>
          <Input
            id="priority"
            type="number"
            min="1"
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            required
            data-testid="input-priority"
          />
        </div>
        {needsDateTolerance && (
          <div className="space-y-2">
            <Label htmlFor="dateTolerance">Date Tolerance (± days)</Label>
            <Input
              id="dateTolerance"
              type="number"
              step="1"
              value={dateTolerance}
              onChange={(e) => setDateTolerance(e.target.value)}
              data-testid="input-date-tolerance"
            />
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor="amountTolerance">Amount Tolerance (±₹)</Label>
          <Input
            id="amountTolerance"
            type="number"
            step="0.01"
            value={amountTolerance}
            onChange={(e) => setAmountTolerance(e.target.value)}
            data-testid="input-amount-tolerance"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="amountTolerancePct">Amount Tolerance (%)</Label>
          <Input
            id="amountTolerancePct"
            type="number"
            step="0.01"
            value={amountTolerancePct}
            onChange={(e) => setAmountTolerancePct(e.target.value)}
            data-testid="input-amount-tolerance-pct"
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="classification">Classification</Label>
        <Select value={classification} onValueChange={setClassification}>
          <SelectTrigger data-testid="select-classification">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CLASSIFICATIONS.map((c) => (
              <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          data-testid="input-description"
        />
      </div>
      {(ruleType === "fuzzy_narration_match" || ruleType === "combined_scoring") && (
        <div className="space-y-2">
          <Label htmlFor="params">Parameters (JSON)</Label>
          <Textarea
            id="params"
            value={params}
            onChange={(e) => setParams(e.target.value)}
            rows={2}
            placeholder='{"fuzzyThreshold": 0.8, "minNarrationLength": 20}'
            data-testid="input-params"
          />
        </div>
      )}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Switch checked={active} onCheckedChange={setActive} data-testid="switch-active" />
          <Label>Active</Label>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={isPending} data-testid="button-save-rule">
            {isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {rule ? "Update" : "Create"} Rule
          </Button>
        </div>
      </div>
    </form>
  );
}

export default function RuleConfig({ embedded = false }: { embedded?: boolean } = {}) {
  const { toast } = useToast();
  const [editingRule, setEditingRule] = useState<Rule | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const { data: rules, isLoading } = useQuery<Rule[]>({
    queryKey: ["/api/rules"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/rules", data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Rule Created" });
      setShowCreate(false);
      queryClient.invalidateQueries({ queryKey: ["/api/rules"] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: any }) => {
      const res = await apiRequest("PATCH", `/api/rules/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Rule Updated" });
      setEditingRule(null);
      queryClient.invalidateQueries({ queryKey: ["/api/rules"] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/rules/${id}`);
    },
    onSuccess: () => {
      toast({ title: "Rule Deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/rules"] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const resetMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/rules/reset");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Rules Reset", description: "Default 10 rules restored (IC-R1 to IC-R10)" });
      queryClient.invalidateQueries({ queryKey: ["/api/rules"] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const toggleActive = (rule: Rule) => {
    updateMutation.mutate({ id: rule.id, data: { active: !rule.active } });
  };

  return (
    <div className={embedded ? "space-y-4" : "p-6 space-y-6"}>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        {!embedded && (
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-page-title">Rule Configuration</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Configure and manage reconciliation matching rules (IC-R1 to IC-R10)
            </p>
          </div>
        )}
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => resetMutation.mutate()} disabled={resetMutation.isPending} data-testid="button-reset-rules">
            {resetMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RotateCcw className="w-4 h-4 mr-2" />}
            Reset to Defaults
          </Button>
          <Dialog open={showCreate} onOpenChange={setShowCreate}>
            <DialogTrigger asChild>
              <Button data-testid="button-add-rule">
                <Plus className="w-4 h-4 mr-2" />
                Add Rule
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Create New Rule</DialogTitle>
              </DialogHeader>
              <RuleForm
                onSubmit={(data) => createMutation.mutate(data)}
                isPending={createMutation.isPending}
                onClose={() => setShowCreate(false)}
              />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : !rules || rules.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center mb-3">
              <Settings2 className="w-7 h-7 text-muted-foreground" />
            </div>
            <h3 className="text-base font-semibold mb-1">No Rules Configured</h3>
            <p className="text-sm text-muted-foreground">Add reconciliation rules to get started</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {rules.map((rule) => (
            <Card key={rule.id} data-testid={`card-rule-${rule.id}`}>
              <CardContent className="p-4">
                <div className="flex items-center gap-4">
                  <div className="text-muted-foreground">
                    <GripVertical className="w-4 h-4" />
                  </div>
                  <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                    <span className="text-xs font-bold text-primary">{rule.priority}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-mono text-muted-foreground">{rule.ruleId}</span>
                      <h3 className="text-sm font-semibold">{rule.name}</h3>
                      <Badge variant="secondary" className="text-xs">
                        {RULE_TYPES.find((rt) => rt.value === rule.ruleType)?.label || rule.ruleType}
                      </Badge>
                      <Badge variant="secondary" className="text-xs">
                        {rule.matchType || "1:1"}
                      </Badge>
                      {rule.classification && (
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${CLASSIFICATION_COLORS[rule.classification] || ""}`}>
                          {rule.classification}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                      {rule.dateTolerance !== null && rule.dateTolerance !== undefined && (
                        <span>Date: ±{rule.dateTolerance}d</span>
                      )}
                      {(rule.amountTolerance || 0) > 0 && (
                        <span>Amt: ±₹{rule.amountTolerance}</span>
                      )}
                      {(rule.amountTolerancePct || 0) > 0 && (
                        <span>Amt: ±{((rule.amountTolerancePct || 0) * 100).toFixed(1)}%</span>
                      )}
                      {rule.description && (
                        <span className="line-clamp-1">{rule.description}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Switch
                      checked={rule.active ?? false}
                      onCheckedChange={() => toggleActive(rule)}
                      data-testid={`switch-rule-${rule.id}`}
                    />
                    <Dialog
                      open={editingRule?.id === rule.id}
                      onOpenChange={(open) => !open && setEditingRule(null)}
                    >
                      <DialogTrigger asChild>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => setEditingRule(rule)}
                          data-testid={`button-edit-rule-${rule.id}`}
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="max-w-lg">
                        <DialogHeader>
                          <DialogTitle>Edit Rule</DialogTitle>
                        </DialogHeader>
                        <RuleForm
                          rule={rule}
                          onSubmit={(data) => updateMutation.mutate({ id: rule.id, data })}
                          isPending={updateMutation.isPending}
                          onClose={() => setEditingRule(null)}
                        />
                      </DialogContent>
                    </Dialog>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => deleteMutation.mutate(rule.id)}
                      data-testid={`button-delete-rule-${rule.id}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
