import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";

interface AuthUser {
  id: string;
  username: string;
  displayName: string | null;
  role: string;
  mustChangePassword?: boolean;
  allowedModules?: string[];
}

export function useAuth() {
  const { data: user, isLoading } = useQuery<AuthUser | null>({
    queryKey: ["/api/auth/me"],
    queryFn: async () => {
      const res = await fetch("/api/auth/me", { credentials: "include" });
      if (res.status === 401) return null;
      if (!res.ok) return null;
      return res.json();
    },
    staleTime: 1000 * 60 * 5,
    retry: false,
  });

  const loginMutation = useMutation({
    mutationFn: async (credentials: { username: string; password: string }) => {
      const res = await apiRequest("POST", "/api/auth/login", credentials);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    },
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/auth/logout");
    },
    onSuccess: () => {
      queryClient.setQueryData(["/api/auth/me"], null);
      queryClient.clear();
    },
  });

  const allModules = ["ic_recon", "cashflow", "ic_matrix"];
  const allowedModules = user?.role === "platform_admin"
    ? allModules
    : (user?.allowedModules || allModules);

  return {
    user: user ?? null,
    isLoading,
    isAuthenticated: !!user,
    isAdmin: user?.role === "platform_admin",
    isViewer: user?.role === "viewer",
    mustChangePassword: !!user?.mustChangePassword,
    allowedModules,
    hasModule: (mod: string) => user?.role === "platform_admin" || allowedModules.includes(mod),
    login: loginMutation,
    logout: logoutMutation,
  };
}
