import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import {
  Brain,
  Lightbulb,
  AlertTriangle,
  Tags,
  BarChart3,
  CheckCircle,
  XCircle,
  Loader2,
  RefreshCw,
  TrendingUp,
  Shield,
  Zap,
  Eye,
} from "lucide-react";

function formatAmount(val: number | null): string {
  if (val === null || val === undefined) return "-";
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(val);
}

function ConfidenceBadge({ score }: { score: number }) {
  if (score >= 80) return <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">{score}%</Badge>;
  if (score >= 50) return <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">{score}%</Badge>;
  return <Badge className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">{score}%</Badge>;
}

function SeverityBadge({ severity }: { severity: string }) {
  const colors: Record<string, string> = {
    high: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
    medium: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
    low: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  };
  return <Badge className={colors[severity] || colors.medium}>{severity}</Badge>;
}

export default function AiInsights({ embedded = false }: { embedded?: boolean } = {}) {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("overview");

  const { data: summary, isLoading: summaryLoading } = useQuery<any>({
    queryKey: ["/api/ml/summary"],
  });

  const { data: suggestions = [], isLoading: suggestionsLoading } = useQuery<any[]>({
    queryKey: ["/api/ml/suggestions"],
  });

  const { data: anomalies = [], isLoading: anomaliesLoading } = useQuery<any[]>({
    queryKey: ["/api/ml/anomalies", { resolved: "false" }],
    queryFn: async () => {
      const res = await fetch("/api/ml/anomalies?resolved=false");
      if (!res.ok) throw new Error(`Failed to fetch anomalies: ${res.status}`);
      return res.json();
    },
  });

  const { data: classifications = [], isLoading: classificationsLoading } = useQuery<any[]>({
    queryKey: ["/api/ml/classifications"],
  });

  const { data: confidenceDist } = useQuery<any>({
    queryKey: ["/api/ml/confidence/distribution"],
  });

  const analyzeMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/ml/analyze"),
    onSuccess: () => {
      toast({ title: "Analysis Complete", description: "AI/ML analysis has been completed successfully." });
      queryClient.invalidateQueries({ queryKey: ["/api/ml"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ml/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ml/suggestions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ml/anomalies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ml/classifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ml/confidence/distribution"] });
    },
    onError: () => {
      toast({ title: "Error", description: "ML analysis failed", variant: "destructive" });
    },
  });

  const acceptMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/ml/suggestions/${id}/accept`),
    onSuccess: () => {
      toast({ title: "Suggestion Accepted", description: "Transactions have been matched." });
      queryClient.invalidateQueries({ queryKey: ["/api/ml/suggestions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ml/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/ml/suggestions/${id}/reject`),
    onSuccess: () => {
      toast({ title: "Suggestion Rejected" });
      queryClient.invalidateQueries({ queryKey: ["/api/ml/suggestions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ml/summary"] });
    },
  });

  const resolveMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/ml/anomalies/${id}/resolve`),
    onSuccess: () => {
      toast({ title: "Anomaly Resolved" });
      queryClient.invalidateQueries({ queryKey: ["/api/ml/anomalies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ml/summary"] });
    },
  });

  const classLabels: Record<string, { label: string; color: string; icon: any }> = {
    timing_difference: { label: "Timing Difference", color: "bg-blue-100 text-blue-800", icon: TrendingUp },
    amount_discrepancy: { label: "Amount Discrepancy", color: "bg-orange-100 text-orange-800", icon: AlertTriangle },
    missing_counterparty_entry: { label: "Missing Counterparty", color: "bg-red-100 text-red-800", icon: XCircle },
    no_clear_match: { label: "No Clear Match", color: "bg-gray-100 text-gray-800", icon: Eye },
    rule_gap: { label: "Rule Gap", color: "bg-purple-100 text-purple-800", icon: Zap },
    already_consumed: { label: "Already Consumed", color: "bg-yellow-100 text-yellow-800", icon: Shield },
    data_quality: { label: "Data Quality Issue", color: "bg-pink-100 text-pink-800", icon: AlertTriangle },
    unknown: { label: "Unknown", color: "bg-gray-100 text-gray-800", icon: Eye },
  };

  return (
    <div className={embedded ? "space-y-4" : "p-6 space-y-6"} data-testid="page-ai-insights">
      <div className="flex items-center justify-between">
        {!embedded && (
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-page-title">
              <Brain className="w-7 h-7 text-purple-500" />
              AI Insights
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Machine learning analysis of your reconciliation data
            </p>
          </div>
        )}
        <Button
          onClick={() => analyzeMutation.mutate()}
          disabled={analyzeMutation.isPending}
          data-testid="button-run-analysis"
          className="bg-purple-600 hover:bg-purple-700"
        >
          {analyzeMutation.isPending ? (
            <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Analyzing...</>
          ) : (
            <><RefreshCw className="w-4 h-4 mr-2" />Run Analysis</>
          )}
        </Button>
      </div>

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <Card data-testid="card-kpi-suggestions">
            <CardContent className="pt-4 pb-3 px-4">
              <div className="flex items-center gap-2 mb-1">
                <Lightbulb className="w-4 h-4 text-yellow-500" />
                <p className="text-xs text-muted-foreground">Suggestions</p>
              </div>
              <p className="text-2xl font-bold">{summary.pendingSuggestions}</p>
            </CardContent>
          </Card>
          <Card data-testid="card-kpi-anomalies">
            <CardContent className="pt-4 pb-3 px-4">
              <div className="flex items-center gap-2 mb-1">
                <AlertTriangle className="w-4 h-4 text-red-500" />
                <p className="text-xs text-muted-foreground">Anomalies</p>
              </div>
              <p className="text-2xl font-bold">{summary.unresolvedAnomalies}</p>
            </CardContent>
          </Card>
          <Card data-testid="card-kpi-classified">
            <CardContent className="pt-4 pb-3 px-4">
              <div className="flex items-center gap-2 mb-1">
                <Tags className="w-4 h-4 text-blue-500" />
                <p className="text-xs text-muted-foreground">Classified</p>
              </div>
              <p className="text-2xl font-bold">{summary.classifiedUnmatched}</p>
            </CardContent>
          </Card>
          <Card data-testid="card-kpi-scored">
            <CardContent className="pt-4 pb-3 px-4">
              <div className="flex items-center gap-2 mb-1">
                <BarChart3 className="w-4 h-4 text-green-500" />
                <p className="text-xs text-muted-foreground">Scored</p>
              </div>
              <p className="text-2xl font-bold">{summary.scoredMatches}</p>
            </CardContent>
          </Card>
          <Card data-testid="card-kpi-confidence">
            <CardContent className="pt-4 pb-3 px-4">
              <div className="flex items-center gap-2 mb-1">
                <TrendingUp className="w-4 h-4 text-purple-500" />
                <p className="text-xs text-muted-foreground">Avg Confidence</p>
              </div>
              <p className="text-2xl font-bold">{summary.avgConfidence}%</p>
            </CardContent>
          </Card>
          <Card data-testid="card-kpi-patterns">
            <CardContent className="pt-4 pb-3 px-4">
              <div className="flex items-center gap-2 mb-1">
                <Brain className="w-4 h-4 text-indigo-500" />
                <p className="text-xs text-muted-foreground">Learned</p>
              </div>
              <p className="text-2xl font-bold">{summary.learnedPatterns}</p>
            </CardContent>
          </Card>
        </div>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList data-testid="tabs-ai">
          <TabsTrigger value="overview" data-testid="tab-overview">Overview</TabsTrigger>
          <TabsTrigger value="suggestions" data-testid="tab-suggestions">
            Smart Suggestions {suggestions.length > 0 && <Badge className="ml-1" variant="secondary">{suggestions.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="anomalies" data-testid="tab-anomalies">
            Anomalies {anomalies.length > 0 && <Badge className="ml-1" variant="destructive">{anomalies.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="classifications" data-testid="tab-classifications">
            Classifications
          </TabsTrigger>
          <TabsTrigger value="confidence" data-testid="tab-confidence">
            Confidence
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4 mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {summary?.classificationBreakdown && Object.keys(summary.classificationBreakdown).length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Tags className="w-4 h-4" />
                    Why Transactions Are Unmatched
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {Object.entries(summary.classificationBreakdown).map(([key, count]: [string, any]) => {
                    const info = classLabels[key] || classLabels.unknown;
                    const total = Object.values(summary.classificationBreakdown as Record<string, number>).reduce((s: number, v: number) => s + v, 0);
                    const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                    return (
                      <div key={key} className="space-y-1" data-testid={`classification-${key}`}>
                        <div className="flex justify-between text-sm">
                          <span className="flex items-center gap-2">
                            <Badge className={info.color}>{info.label}</Badge>
                          </span>
                          <span className="font-medium">{count} ({pct}%)</span>
                        </div>
                        <Progress value={pct} className="h-2" />
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            )}

            {summary?.anomalyBreakdown && Object.keys(summary.anomalyBreakdown).length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4" />
                    Anomaly Breakdown
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {Object.entries(summary.anomalyBreakdown).map(([key, count]: [string, any]) => {
                    const labels: Record<string, string> = {
                      amount_outlier: "Amount Outliers",
                      missing_counterparty: "Missing Counterparty",
                      potential_duplicate: "Potential Duplicates",
                      weekend_transaction: "Weekend Transactions",
                      date_outlier: "Date Outliers",
                    };
                    return (
                      <div key={key} className="flex justify-between items-center text-sm" data-testid={`anomaly-type-${key}`}>
                        <span>{labels[key] || key}</span>
                        <Badge variant="outline">{count}</Badge>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            )}

            {confidenceDist && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <BarChart3 className="w-4 h-4" />
                    Match Confidence Distribution
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {confidenceDist.buckets?.map((bucket: any) => {
                    const pct = confidenceDist.total > 0 ? Math.round((bucket.count / confidenceDist.total) * 100) : 0;
                    const colors: Record<string, string> = {
                      "90-100%": "bg-green-500",
                      "75-89%": "bg-blue-500",
                      "50-74%": "bg-yellow-500",
                      "25-49%": "bg-orange-500",
                      "0-24%": "bg-red-500",
                    };
                    return (
                      <div key={bucket.range} className="space-y-1" data-testid={`confidence-bucket-${bucket.range}`}>
                        <div className="flex justify-between text-sm">
                          <span>{bucket.range}</span>
                          <span className="font-medium">{bucket.count} ({pct}%)</span>
                        </div>
                        <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${colors[bucket.range] || "bg-gray-400"}`} style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                  <div className="pt-2 border-t text-sm text-muted-foreground">
                    Average confidence: <span className="font-bold text-foreground">{confidenceDist.avgScore}%</span> across {confidenceDist.total} scored matches
                  </div>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Brain className="w-4 h-4" />
                  How It Works
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-muted-foreground">
                <div className="flex gap-3">
                  <Lightbulb className="w-5 h-5 text-yellow-500 shrink-0 mt-0.5" />
                  <div><strong className="text-foreground">Smart Suggestions</strong> - Finds potential matches among unmatched transactions using multi-factor scoring</div>
                </div>
                <div className="flex gap-3">
                  <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                  <div><strong className="text-foreground">Anomaly Detection</strong> - Identifies outliers, duplicates, missing counterparties, and unusual patterns</div>
                </div>
                <div className="flex gap-3">
                  <Tags className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" />
                  <div><strong className="text-foreground">Auto-Classification</strong> - Explains why each transaction remains unmatched</div>
                </div>
                <div className="flex gap-3">
                  <BarChart3 className="w-5 h-5 text-green-500 shrink-0 mt-0.5" />
                  <div><strong className="text-foreground">Confidence Scoring</strong> - Rates each match with a multi-factor confidence percentage</div>
                </div>
                <div className="flex gap-3">
                  <Brain className="w-5 h-5 text-purple-500 shrink-0 mt-0.5" />
                  <div><strong className="text-foreground">Learning</strong> - Improves over time from your manual matches and corrections</div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="suggestions" className="mt-4">
          {suggestionsLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin" /></div>
          ) : suggestions.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <Lightbulb className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>No pending suggestions. Run Analysis to generate match suggestions.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {suggestions.map((s: any) => (
                <Card key={s.id} data-testid={`suggestion-${s.id}`}>
                  <CardContent className="py-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2">
                          <Lightbulb className="w-4 h-4 text-yellow-500" />
                          <span className="font-medium text-sm">Suggested Match</span>
                          <ConfidenceBadge score={s.confidenceScore || 0} />
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                          <div className="p-3 bg-green-50 dark:bg-green-900/20 rounded-lg">
                            <div className="font-medium text-green-700 dark:text-green-400 mb-1">
                              {s.lineA?.company || "Unknown"}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              Doc: {s.lineA?.documentNo || "-"} | Date: {s.lineA?.docDate || "-"}
                            </div>
                            <div className="font-medium mt-1">{formatAmount(s.lineA?.netAmount)}</div>
                            <div className="text-xs text-muted-foreground truncate mt-1">{s.lineA?.narration || "-"}</div>
                          </div>
                          <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-lg">
                            <div className="font-medium text-red-700 dark:text-red-400 mb-1">
                              {s.lineB?.company || "Unknown"}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              Doc: {s.lineB?.documentNo || "-"} | Date: {s.lineB?.docDate || "-"}
                            </div>
                            <div className="font-medium mt-1">{formatAmount(s.lineB?.netAmount)}</div>
                            <div className="text-xs text-muted-foreground truncate mt-1">{s.lineB?.narration || "-"}</div>
                          </div>
                        </div>
                        <div className="mt-2 text-xs text-muted-foreground">
                          <strong>Score breakdown:</strong> Amount {s.amountScore}% | Date {s.dateScore}% | Narration {s.narrationScore}% | Reference {s.referenceScore}% | Pattern {s.patternScore}%
                        </div>
                        {s.reasoning && (
                          <div className="mt-1 text-xs text-muted-foreground italic">{s.reasoning}</div>
                        )}
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-green-600 border-green-300 hover:bg-green-50"
                          onClick={() => acceptMutation.mutate(s.id)}
                          disabled={acceptMutation.isPending}
                          data-testid={`button-accept-${s.id}`}
                        >
                          <CheckCircle className="w-4 h-4 mr-1" /> Accept
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-red-600 border-red-300 hover:bg-red-50"
                          onClick={() => rejectMutation.mutate(s.id)}
                          disabled={rejectMutation.isPending}
                          data-testid={`button-reject-${s.id}`}
                        >
                          <XCircle className="w-4 h-4 mr-1" /> Reject
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="anomalies" className="mt-4">
          {anomaliesLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin" /></div>
          ) : anomalies.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <Shield className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>No unresolved anomalies detected. Run Analysis to scan for issues.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {anomalies.map((a: any) => (
                <Card key={a.id} data-testid={`anomaly-${a.id}`}>
                  <CardContent className="py-3 px-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <SeverityBadge severity={a.severity || "medium"} />
                          <Badge variant="outline" className="text-xs">{a.anomalyType?.replace(/_/g, " ")}</Badge>
                          {a.line && (
                            <span className="text-xs text-muted-foreground">{a.line.company} | {formatAmount(a.line.netAmount)}</span>
                          )}
                        </div>
                        <p className="text-sm">{a.description}</p>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => resolveMutation.mutate(a.id)}
                        data-testid={`button-resolve-${a.id}`}
                      >
                        <CheckCircle className="w-4 h-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="classifications" className="mt-4">
          {classificationsLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin" /></div>
          ) : classifications.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <Tags className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>No classifications generated. Run Analysis to classify unmatched transactions.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {classifications.map((c: any) => {
                const info = classLabels[c.classification] || classLabels.unknown;
                return (
                  <Card key={c.id} data-testid={`class-${c.id}`}>
                    <CardContent className="py-3 px-4">
                      <div className="flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <Badge className={info.color}>{info.label}</Badge>
                            <ConfidenceBadge score={c.confidence || 0} />
                            {c.line && (
                              <span className="text-xs text-muted-foreground">
                                {c.line.company} &rarr; {c.line.counterParty} | {formatAmount(c.line.netAmount)}
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground">{c.reasoning}</p>
                          {c.suggestedAction && (
                            <p className="text-xs text-blue-600 dark:text-blue-400 mt-1 flex items-center gap-1">
                              <Zap className="w-3 h-3" /> {c.suggestedAction}
                            </p>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="confidence" className="mt-4">
          {confidenceDist ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Confidence Distribution</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {confidenceDist.buckets?.map((bucket: any) => {
                    const pct = confidenceDist.total > 0 ? Math.round((bucket.count / confidenceDist.total) * 100) : 0;
                    const barColors: Record<string, string> = {
                      "90-100%": "bg-green-500",
                      "75-89%": "bg-blue-500",
                      "50-74%": "bg-yellow-500",
                      "25-49%": "bg-orange-500",
                      "0-24%": "bg-red-500",
                    };
                    return (
                      <div key={bucket.range} className="space-y-1">
                        <div className="flex justify-between text-sm">
                          <span className="font-medium">{bucket.range}</span>
                          <span>{bucket.count} matches ({pct}%)</span>
                        </div>
                        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${barColors[bucket.range] || "bg-gray-400"}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Confidence Summary</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="text-center py-6">
                    <div className="text-5xl font-bold text-purple-600">{confidenceDist.avgScore}%</div>
                    <p className="text-sm text-muted-foreground mt-2">Average Match Confidence</p>
                  </div>
                  <div className="grid grid-cols-2 gap-4 text-center">
                    <div className="p-3 bg-green-50 dark:bg-green-900/20 rounded-lg">
                      <div className="text-lg font-bold text-green-700 dark:text-green-400">
                        {confidenceDist.buckets?.find((b: any) => b.range === "90-100%")?.count || 0}
                      </div>
                      <p className="text-xs text-muted-foreground">High Confidence</p>
                    </div>
                    <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-lg">
                      <div className="text-lg font-bold text-red-700 dark:text-red-400">
                        {confidenceDist.buckets?.find((b: any) => b.range === "0-24%")?.count || 0}
                      </div>
                      <p className="text-xs text-muted-foreground">Low Confidence</p>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Total scored matches: {confidenceDist.total}. Confidence is computed from amount accuracy, date proximity, narration similarity, reference matches, and learned patterns.
                  </p>
                </CardContent>
              </Card>
            </div>
          ) : (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <BarChart3 className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>No confidence scores available. Run Analysis after reconciliation.</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
