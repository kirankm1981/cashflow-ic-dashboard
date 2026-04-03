import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Shield, Eye, EyeOff, Check, X, LogOut } from "lucide-react";

export default function ForceChangePassword() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const { toast } = useToast();
  const { logout, user } = useAuth();

  const { data: passwordRules } = useQuery<{ rules: string[]; maxAgeDays: number; minLength: number }>({
    queryKey: ["/api/auth/password-rules"],
  });

  const rules = passwordRules?.rules || [
    "At least 8 characters",
    "At least one uppercase letter",
    "At least one lowercase letter",
    "At least one number",
    "At least one special character (!@#$%^&*...)",
  ];

  const ruleChecks = [
    { label: rules[0] || "At least 8 characters", pass: newPassword.length >= (passwordRules?.minLength || 8) },
    { label: rules[1] || "At least one uppercase letter", pass: /[A-Z]/.test(newPassword) },
    { label: rules[2] || "At least one lowercase letter", pass: /[a-z]/.test(newPassword) },
    { label: rules[3] || "At least one number", pass: /[0-9]/.test(newPassword) },
    { label: rules[4] || "At least one special character", pass: /[!@#$%^&*()_+\-=\[\]{}|;':",.<>?\/\\`~]/.test(newPassword) },
  ];

  const allRulesPass = ruleChecks.every(r => r.pass);
  const passwordsMatch = newPassword === confirmPassword && confirmPassword.length > 0;

  const changeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/auth/change-password", { currentPassword, newPassword });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Password changed successfully", description: "You can now use the application." });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    },
    onError: (error: any) => {
      const msg = error?.message || "Password change failed";
      let description = msg;
      if (msg.includes("complexity")) {
        description = "Password does not meet the requirements listed below.";
      } else if (msg.includes("incorrect")) {
        description = "The current password you entered is incorrect.";
      } else if (msg.includes("different")) {
        description = "New password must be different from your current password.";
      }
      toast({ title: "Password change failed", description, variant: "destructive" });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!allRulesPass || !passwordsMatch) return;
    changeMutation.mutate();
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4">
      <Card className="w-full max-w-lg border-slate-700 bg-slate-800/80 backdrop-blur">
        <CardHeader className="text-center space-y-4 pb-2">
          <div className="mx-auto w-14 h-14 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-lg">
            <Shield className="w-8 h-8 text-white" />
          </div>
          <div>
            <CardTitle className="text-xl font-bold text-white" data-testid="text-change-password-title">
              Password Change Required
            </CardTitle>
            <CardDescription className="text-slate-400">
              You must change your password before continuing. Passwords expire every 90 days.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {changeMutation.isError && (
              <div className="p-3 rounded-md bg-red-500/10 border border-red-500/30 text-red-400 text-sm" data-testid="text-change-pw-error">
                {(changeMutation.error as Error)?.message || "Password change failed"}
              </div>
            )}

            <div className="space-y-2">
              <label className="text-sm text-slate-300">Current Password</label>
              <div className="relative">
                <Input
                  data-testid="input-current-password"
                  type={showCurrent ? "text" : "password"}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Enter current password"
                  className="bg-slate-700/50 border-slate-600 text-white placeholder:text-slate-500 pr-10"
                  autoComplete="current-password"
                />
                <button type="button" onClick={() => setShowCurrent(!showCurrent)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-300">
                  {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm text-slate-300">New Password</label>
              <div className="relative">
                <Input
                  data-testid="input-new-password"
                  type={showNew ? "text" : "password"}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Enter new password"
                  className="bg-slate-700/50 border-slate-600 text-white placeholder:text-slate-500 pr-10"
                  autoComplete="new-password"
                />
                <button type="button" onClick={() => setShowNew(!showNew)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-300">
                  {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm text-slate-300">Confirm New Password</label>
              <div className="relative">
                <Input
                  data-testid="input-confirm-password"
                  type={showConfirm ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter new password"
                  className="bg-slate-700/50 border-slate-600 text-white placeholder:text-slate-500 pr-10"
                  autoComplete="new-password"
                />
                <button type="button" onClick={() => setShowConfirm(!showConfirm)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-300">
                  {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {confirmPassword.length > 0 && !passwordsMatch && (
                <p className="text-xs text-red-400 flex items-center gap-1" data-testid="text-passwords-mismatch">
                  <X className="w-3 h-3" /> Passwords do not match
                </p>
              )}
            </div>

            <div className="p-3 rounded-md bg-slate-700/50 border border-slate-600 space-y-1.5">
              <p className="text-xs font-medium text-slate-300 mb-2">Password Requirements:</p>
              {ruleChecks.map((rule, i) => (
                <div key={i} className={`flex items-center gap-2 text-xs ${rule.pass ? "text-emerald-400" : "text-slate-400"}`} data-testid={`text-password-rule-${i}`}>
                  {rule.pass ? <Check className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5 text-slate-500" />}
                  {rule.label}
                </div>
              ))}
            </div>

            <Button
              type="submit"
              className="w-full bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700"
              disabled={changeMutation.isPending || !currentPassword || !allRulesPass || !passwordsMatch}
              data-testid="button-change-password"
            >
              {changeMutation.isPending ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Changing password...
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <Shield className="w-4 h-4" />
                  Change Password
                </span>
              )}
            </Button>

            <Button
              type="button"
              variant="ghost"
              className="w-full text-slate-400 hover:text-slate-300"
              onClick={() => logout.mutate()}
              data-testid="button-logout-force-change"
            >
              <LogOut className="w-4 h-4 mr-2" />
              Sign Out
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
