import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { UserPlus, Pencil, Trash2, Shield, User, ShieldCheck, ShieldX, KeyRound, Ban, CheckCircle2, Check, X } from "lucide-react";

const PASSWORD_RULES = [
  { label: "At least 8 characters", test: (p: string) => p.length >= 8 },
  { label: "At least one uppercase letter", test: (p: string) => /[A-Z]/.test(p) },
  { label: "At least one lowercase letter", test: (p: string) => /[a-z]/.test(p) },
  { label: "At least one number", test: (p: string) => /[0-9]/.test(p) },
  { label: "At least one special character (!@#$%^&*...)", test: (p: string) => /[!@#$%^&*()_+\-=\[\]{}|;':",.<>?\/\\`~]/.test(p) },
];

function PasswordHints({ password }: { password: string }) {
  if (!password) {
    return (
      <div className="mt-2 space-y-1" data-testid="password-requirements-hint">
        <p className="text-xs text-muted-foreground font-medium">Password must contain:</p>
        {PASSWORD_RULES.map((r, i) => (
          <p key={i} className="text-xs text-muted-foreground flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full border border-muted-foreground/30 inline-block flex-shrink-0" />
            {r.label}
          </p>
        ))}
      </div>
    );
  }
  return (
    <div className="mt-2 space-y-1" data-testid="password-requirements-live">
      <p className="text-xs text-muted-foreground font-medium">Password requirements:</p>
      {PASSWORD_RULES.map((r, i) => {
        const pass = r.test(password);
        return (
          <p key={i} className={`text-xs flex items-center gap-1.5 ${pass ? "text-emerald-500" : "text-muted-foreground"}`}>
            {pass ? <Check className="w-3 h-3 flex-shrink-0" /> : <X className="w-3 h-3 flex-shrink-0" />}
            {r.label}
          </p>
        );
      })}
    </div>
  );
}

const ALL_MODULES = [
  { key: "ic_recon", label: "IC Recon" },
  { key: "cashflow", label: "Cashflow" },
  { key: "ic_matrix", label: "IC Matrix" },
];

interface ManagedUser {
  id: string;
  username: string;
  displayName: string | null;
  role: string;
  active: boolean;
  allowedModules: string[];
  createdAt: string | null;
}

export default function UserManagement() {
  const { user: currentUser } = useAuth();
  const { toast } = useToast();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editUser, setEditUser] = useState<ManagedUser | null>(null);
  const [resetPwUser, setResetPwUser] = useState<ManagedUser | null>(null);
  const [resetPwValue, setResetPwValue] = useState("");
  const [deleteConfirmUser, setDeleteConfirmUser] = useState<ManagedUser | null>(null);
  const [newUser, setNewUser] = useState({ username: "", password: "", displayName: "", role: "recon_user", allowedModules: ["ic_recon", "cashflow", "ic_matrix"] as string[] });
  const [editFields, setEditFields] = useState({ displayName: "", role: "", password: "", active: true, allowedModules: ["ic_recon", "cashflow", "ic_matrix"] as string[] });

  const { data: users = [], isLoading } = useQuery<ManagedUser[]>({
    queryKey: ["/api/users"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof newUser) => {
      const res = await apiRequest("POST", "/api/users", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setShowCreateDialog(false);
      setNewUser({ username: "", password: "", displayName: "", role: "recon_user", allowedModules: ["ic_recon", "cashflow", "ic_matrix"] });
      toast({ title: "User created successfully" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to create user", description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: any }) => {
      const res = await apiRequest("PATCH", `/api/users/${id}`, updates);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setEditUser(null);
      toast({ title: "User updated successfully" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to update user", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/users/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: "User deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to delete user", description: err.message, variant: "destructive" });
    },
  });

  const openEdit = (u: ManagedUser) => {
    setEditUser(u);
    setEditFields({ displayName: u.displayName || "", role: u.role, password: "", active: u.active, allowedModules: u.allowedModules || ["ic_recon", "cashflow", "ic_matrix"] });
  };

  const handleUpdate = () => {
    if (!editUser) return;
    const updates: any = {};
    if (editFields.displayName !== (editUser.displayName || "")) updates.displayName = editFields.displayName;
    if (editFields.role !== editUser.role) updates.role = editFields.role;
    if (editFields.active !== editUser.active) updates.active = editFields.active;
    if (editFields.password) updates.password = editFields.password;
    const origModules = editUser.allowedModules || ["ic_recon", "cashflow", "ic_matrix"];
    if (JSON.stringify(editFields.allowedModules.sort()) !== JSON.stringify(origModules.sort())) {
      updates.allowedModules = editFields.allowedModules;
    }
    updateMutation.mutate({ id: editUser.id, updates });
  };

  if (isLoading) {
    return (
      <div className="p-6 flex justify-center">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-user-mgmt-title">User Management</h1>
          <p className="text-sm text-muted-foreground">{users.length} users registered</p>
        </div>
        <Button onClick={() => setShowCreateDialog(true)} data-testid="button-create-user">
          <UserPlus className="w-4 h-4 mr-2" />
          Add User
        </Button>
      </div>

      <div className="space-y-3">
        {users.map((u) => (
          <Card key={u.id} className={`${!u.active ? "opacity-60" : ""}`} data-testid={`card-user-${u.id}`}>
            <CardContent className="flex items-center justify-between py-4 px-5">
              <div className="flex items-center gap-4">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${u.role === "platform_admin" ? "bg-amber-500/15 text-amber-500" : "bg-blue-500/15 text-blue-500"}`}>
                  {u.role === "platform_admin" ? <Shield className="w-5 h-5" /> : <User className="w-5 h-5" />}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium" data-testid={`text-user-name-${u.id}`}>{u.displayName || u.username}</span>
                    {u.id === currentUser?.id && (
                      <Badge variant="outline" className="text-[10px]">You</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <span>@{u.username}</span>
                    <span className="text-muted-foreground/40">|</span>
                    <Badge variant={u.role === "platform_admin" ? "default" : "secondary"} className="text-[10px]">
                      {u.role === "platform_admin" ? "Admin" : u.role === "viewer" ? "Viewer" : "Recon User"}
                    </Badge>
                    {!u.active && (
                      <Badge variant="destructive" className="text-[10px]">Disabled</Badge>
                    )}
                  </div>
                  {u.role !== "platform_admin" && (
                    <div className="flex items-center gap-1 mt-0.5">
                      {ALL_MODULES.map(m => (
                        <Badge
                          key={m.key}
                          variant="outline"
                          className={`text-[9px] px-1.5 py-0 ${(u.allowedModules || []).includes(m.key) ? "border-emerald-500/40 text-emerald-500" : "border-muted-foreground/20 text-muted-foreground/40 line-through"}`}
                          data-testid={`badge-module-${m.key}-${u.id}`}
                        >
                          {m.label}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {u.id !== currentUser?.id && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className={u.active ? "text-orange-600 hover:text-orange-700" : "text-emerald-600 hover:text-emerald-700"}
                    onClick={() => updateMutation.mutate({ id: u.id, updates: { active: !u.active } })}
                    title={u.active ? "Deactivate user" : "Activate user"}
                    data-testid={`button-toggle-active-${u.id}`}
                  >
                    {u.active ? <><Ban className="w-4 h-4 mr-1" /> Deactivate</> : <><CheckCircle2 className="w-4 h-4 mr-1" /> Activate</>}
                  </Button>
                )}
                <Button variant="ghost" size="icon" onClick={() => { setResetPwUser(u); setResetPwValue(""); }} title="Reset password" data-testid={`button-reset-pw-${u.id}`}>
                  <KeyRound className="w-4 h-4" />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => openEdit(u)} title="Edit user" data-testid={`button-edit-user-${u.id}`}>
                  <Pencil className="w-4 h-4" />
                </Button>
                {u.id !== currentUser?.id && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setDeleteConfirmUser(u)}
                    title="Delete user"
                    data-testid={`button-delete-user-${u.id}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New User</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <label className="text-sm font-medium">Username</label>
              <Input
                data-testid="input-new-username"
                value={newUser.username}
                onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                placeholder="Username"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Display Name</label>
              <Input
                data-testid="input-new-display-name"
                value={newUser.displayName}
                onChange={(e) => setNewUser({ ...newUser, displayName: e.target.value })}
                placeholder="Display Name"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Password</label>
              <Input
                data-testid="input-new-password"
                type="password"
                value={newUser.password}
                onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                placeholder="Password"
              />
              <PasswordHints password={newUser.password} />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Role</label>
              <Select value={newUser.role} onValueChange={(v) => setNewUser({ ...newUser, role: v })}>
                <SelectTrigger data-testid="select-new-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="viewer">Viewer</SelectItem>
                  <SelectItem value="recon_user">Recon User</SelectItem>
                  <SelectItem value="platform_admin">Platform Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {newUser.role !== "platform_admin" && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Module Access</label>
                <div className="flex flex-col gap-2">
                  {ALL_MODULES.map(m => (
                    <label key={m.key} className="flex items-center gap-2 text-sm cursor-pointer" data-testid={`checkbox-create-module-${m.key}`}>
                      <input
                        type="checkbox"
                        checked={newUser.allowedModules.includes(m.key)}
                        onChange={(e) => {
                          const mods = e.target.checked
                            ? [...newUser.allowedModules, m.key]
                            : newUser.allowedModules.filter(x => x !== m.key);
                          setNewUser({ ...newUser, allowedModules: mods });
                        }}
                        className="rounded border-gray-300"
                      />
                      {m.label}
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>Cancel</Button>
            <Button
              onClick={() => createMutation.mutate(newUser)}
              disabled={createMutation.isPending || !newUser.username || !newUser.password}
              data-testid="button-submit-create-user"
            >
              {createMutation.isPending ? "Creating..." : "Create User"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!resetPwUser} onOpenChange={(open) => !open && setResetPwUser(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset Password: {resetPwUser?.username}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Set a new password for <strong>{resetPwUser?.displayName || resetPwUser?.username}</strong>.
            </p>
            <div className="space-y-1">
              <label className="text-sm font-medium">New Password</label>
              <Input
                data-testid="input-reset-password"
                type="password"
                value={resetPwValue}
                onChange={(e) => setResetPwValue(e.target.value)}
                placeholder="Enter new password"
              />
              <PasswordHints password={resetPwValue} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetPwUser(null)}>Cancel</Button>
            <Button
              onClick={() => {
                if (!resetPwUser || !resetPwValue) return;
                const allPass = PASSWORD_RULES.every(r => r.test(resetPwValue));
                if (!allPass) {
                  toast({ title: "Password does not meet complexity requirements", variant: "destructive" });
                  return;
                }
                updateMutation.mutate({ id: resetPwUser.id, updates: { password: resetPwValue } });
                setResetPwUser(null);
              }}
              disabled={updateMutation.isPending || !resetPwValue}
              data-testid="button-submit-reset-password"
            >
              {updateMutation.isPending ? "Resetting..." : "Reset Password"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteConfirmUser} onOpenChange={(open) => !open && setDeleteConfirmUser(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete User</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm">
              Are you sure you want to permanently delete <strong>{deleteConfirmUser?.displayName || deleteConfirmUser?.username}</strong> (@{deleteConfirmUser?.username})?
            </p>
            <p className="text-sm text-muted-foreground mt-2">
              This action cannot be undone. Consider deactivating the user instead if you may need to restore access later.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmUser(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (deleteConfirmUser) {
                  deleteMutation.mutate(deleteConfirmUser.id);
                  setDeleteConfirmUser(null);
                }
              }}
              disabled={deleteMutation.isPending}
              data-testid="button-confirm-delete-user"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              {deleteMutation.isPending ? "Deleting..." : "Delete User"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editUser} onOpenChange={(open) => !open && setEditUser(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit User: {editUser?.username}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <label className="text-sm font-medium">Display Name</label>
              <Input
                data-testid="input-edit-display-name"
                value={editFields.displayName}
                onChange={(e) => setEditFields({ ...editFields, displayName: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Role</label>
              <Select value={editFields.role} onValueChange={(v) => setEditFields({ ...editFields, role: v })}>
                <SelectTrigger data-testid="select-edit-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="viewer">Viewer</SelectItem>
                  <SelectItem value="recon_user">Recon User</SelectItem>
                  <SelectItem value="platform_admin">Platform Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">New Password (leave blank to keep)</label>
              <Input
                data-testid="input-edit-password"
                type="password"
                value={editFields.password}
                onChange={(e) => setEditFields({ ...editFields, password: e.target.value })}
                placeholder="Leave blank to keep current"
              />
              {editFields.password && <PasswordHints password={editFields.password} />}
            </div>
            {editFields.role !== "platform_admin" && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Module Access</label>
                <div className="flex flex-col gap-2">
                  {ALL_MODULES.map(m => (
                    <label key={m.key} className="flex items-center gap-2 text-sm cursor-pointer" data-testid={`checkbox-edit-module-${m.key}`}>
                      <input
                        type="checkbox"
                        checked={editFields.allowedModules.includes(m.key)}
                        onChange={(e) => {
                          const mods = e.target.checked
                            ? [...editFields.allowedModules, m.key]
                            : editFields.allowedModules.filter(x => x !== m.key);
                          setEditFields({ ...editFields, allowedModules: mods });
                        }}
                        className="rounded border-gray-300"
                      />
                      {m.label}
                    </label>
                  ))}
                </div>
              </div>
            )}
            <div className="flex items-center gap-3 pt-2">
              <label className="text-sm font-medium">Status</label>
              <Button
                variant={editFields.active ? "default" : "destructive"}
                size="sm"
                onClick={() => setEditFields({ ...editFields, active: !editFields.active })}
                data-testid="button-toggle-active"
              >
                {editFields.active ? (
                  <><ShieldCheck className="w-4 h-4 mr-1" /> Active</>
                ) : (
                  <><ShieldX className="w-4 h-4 mr-1" /> Disabled</>
                )}
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditUser(null)}>Cancel</Button>
            <Button
              onClick={handleUpdate}
              disabled={updateMutation.isPending}
              data-testid="button-submit-edit-user"
            >
              {updateMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
