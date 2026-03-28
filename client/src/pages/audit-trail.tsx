import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { FileText, Clock, Hash, GitCompare } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ReconGroup } from "@shared/schema";

export default function AuditTrail({ embedded = false }: { embedded?: boolean } = {}) {
  const { data: groups, isLoading } = useQuery<ReconGroup[]>({
    queryKey: ["/api/recon-groups"],
  });

  return (
    <div className={embedded ? "space-y-4" : "p-6 space-y-6"}>
      {!embedded && (
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Audit Trail</h1>
          <p className="text-sm text-muted-foreground mt-1">
            History of all reconciliation matches and groups
          </p>
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : !groups || groups.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center mb-3">
                <FileText className="w-7 h-7 text-muted-foreground" />
              </div>
              <h3 className="text-base font-semibold mb-1">No Reconciliation History</h3>
              <p className="text-sm text-muted-foreground">Run reconciliation to generate audit records</p>
            </div>
          ) : (
            <ScrollArea className="max-h-[60vh]">
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="table-audit">
                  <thead className="sticky top-0 bg-card z-10">
                    <tr className="border-b">
                      <th className="text-left py-2.5 px-3 text-xs font-medium text-muted-foreground uppercase">Recon ID</th>
                      <th className="text-left py-2.5 px-3 text-xs font-medium text-muted-foreground uppercase">Rule</th>
                      <th className="text-center py-2.5 px-3 text-xs font-medium text-muted-foreground uppercase">Transactions</th>
                      <th className="text-left py-2.5 px-3 text-xs font-medium text-muted-foreground uppercase">Status</th>
                      <th className="text-left py-2.5 px-3 text-xs font-medium text-muted-foreground uppercase">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groups.map((group) => (
                      <tr
                        key={group.id}
                        className="border-b last:border-0 hover:bg-muted/30 transition-colors"
                        data-testid={`row-audit-${group.id}`}
                      >
                        <td className="py-2.5 px-3">
                          <span className="text-xs font-mono font-medium">{group.reconId}</span>
                        </td>
                        <td className="py-2.5 px-3">
                          <Badge variant="secondary">{group.ruleName}</Badge>
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          <span className="inline-flex items-center gap-1 text-xs">
                            <Hash className="w-3 h-3" />
                            {group.transactionCount}
                          </span>
                        </td>
                        <td className="py-2.5 px-3">
                          <Badge variant="default">{group.status}</Badge>
                        </td>
                        <td className="py-2.5 px-3 text-xs text-muted-foreground">
                          {group.createdAt
                            ? new Date(group.createdAt).toLocaleDateString("en-IN", {
                                day: "2-digit",
                                month: "short",
                                year: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              })
                            : "-"}
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
