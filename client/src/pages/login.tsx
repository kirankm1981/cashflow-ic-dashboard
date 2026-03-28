import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Gauge, LogIn, Eye, EyeOff } from "lucide-react";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const { login } = useAuth();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    login.mutate({ username, password });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4">
      <Card className="w-full max-w-md border-slate-700 bg-slate-800/80 backdrop-blur">
        <CardHeader className="text-center space-y-4 pb-2">
          <div className="mx-auto w-14 h-14 rounded-xl bg-gradient-to-br from-emerald-500 to-blue-600 flex items-center justify-center shadow-lg">
            <Gauge className="w-8 h-8 text-white" />
          </div>
          <div>
            <CardTitle className="text-xl font-bold text-white" data-testid="text-login-title">
              Cashflow & IC Dashboard
            </CardTitle>
            <CardDescription className="text-slate-400">
              Sign in to continue
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {login.isError && (
              <div className="p-3 rounded-md bg-red-500/10 border border-red-500/30 text-red-400 text-sm" data-testid="text-login-error">
                {(login.error as Error)?.message?.includes("401")
                  ? "Invalid username or password"
                  : (login.error as Error)?.message?.includes("403")
                  ? "Account is disabled. Contact your administrator."
                  : "Login failed. Please try again."}
              </div>
            )}
            <div className="space-y-2">
              <label className="text-sm text-slate-300">Username</label>
              <Input
                data-testid="input-username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter your username"
                className="bg-slate-700/50 border-slate-600 text-white placeholder:text-slate-500"
                autoFocus
                autoComplete="username"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm text-slate-300">Password</label>
              <div className="relative">
                <Input
                  data-testid="input-password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="bg-slate-700/50 border-slate-600 text-white placeholder:text-slate-500 pr-10"
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-300"
                  data-testid="button-toggle-password"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <Button
              type="submit"
              className="w-full bg-gradient-to-r from-emerald-500 to-blue-600 hover:from-emerald-600 hover:to-blue-700"
              disabled={login.isPending || !username || !password}
              data-testid="button-login"
            >
              {login.isPending ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Signing in...
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <LogIn className="w-4 h-4" />
                  Sign In
                </span>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
