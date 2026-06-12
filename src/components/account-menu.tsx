"use client";

import { useEffect, useState } from "react";
import { LogIn, LogOut, ShieldCheck, UserRound, X } from "lucide-react";
import { useUserData } from "@/components/user-data-provider";

export function AccountMenu() {
  const { user, checkingAuth, syncStatus, authError, login, register, logout } = useUserData();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [stats, setStats] = useState<{ totalUsers: number; activeSessions: number } | null>(null);

  useEffect(() => {
    if (!open || !user?.isAdmin) return;
    fetch("/api/admin/stats").then((response) => response.ok ? response.json() : null).then(setStats).catch(() => setStats(null));
  }, [open, user]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    const ok = await (mode === "login" ? login(email, password) : register(email, password));
    setBusy(false);
    if (ok) setPassword("");
  };

  return (
    <>
      <button
        type="button"
        title={user ? "账户与云同步" : "登录或注册"}
        onClick={() => setOpen(true)}
        className="ml-1 inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
      >
        <UserRound size={17} />
      </button>

      {open && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/65 px-4" onMouseDown={() => setOpen(false)}>
          <div className="w-full max-w-sm rounded-lg border border-white/10 bg-[#151518] p-5 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <div>
                <div className="font-semibold">{user ? "账户与云同步" : mode === "login" ? "登录" : "创建账户"}</div>
                <div className="mt-0.5 text-xs text-white/40">视场、收藏和星图状态将跨设备同步</div>
              </div>
              <button title="关闭" onClick={() => setOpen(false)} className="rounded p-1 text-white/45 hover:bg-white/10 hover:text-white"><X size={17} /></button>
            </div>

            {user ? (
              <div className="space-y-4">
                <div className="rounded-md border border-white/8 bg-white/[.03] p-3">
                  <div className="text-sm text-white/85">{user.email}</div>
                  <div className="mt-1 text-xs text-white/40">
                    {syncStatus === "saving" ? "正在同步…" : syncStatus === "error" ? "同步失败，将在下次更改时重试" : "云端数据已同步"}
                  </div>
                </div>
                {user.isAdmin && (
                  <div className="rounded-md border border-cyan-400/20 bg-cyan-400/5 p-3">
                    <div className="mb-2 flex items-center gap-2 text-sm text-cyan-200"><ShieldCheck size={15} />管理员统计</div>
                    <div className="grid grid-cols-2 gap-2 text-center">
                      <div className="rounded bg-black/20 p-2"><div className="text-lg font-semibold">{stats?.totalUsers ?? "–"}</div><div className="text-[11px] text-white/40">注册用户</div></div>
                      <div className="rounded bg-black/20 p-2"><div className="text-lg font-semibold">{stats?.activeSessions ?? "–"}</div><div className="text-[11px] text-white/40">有效会话</div></div>
                    </div>
                    <div className="mt-2 text-[11px] text-white/35">管理员无法查看用户密码。</div>
                  </div>
                )}
                <button onClick={logout} className="flex w-full items-center justify-center gap-2 rounded-md border border-white/10 py-2 text-sm text-white/65 hover:bg-white/5 hover:text-white">
                  <LogOut size={15} />退出登录
                </button>
              </div>
            ) : (
              <>
                <div className="mb-4 grid grid-cols-2 rounded-md bg-black/30 p-1 text-sm">
                  <button onClick={() => setMode("login")} className={`rounded py-1.5 ${mode === "login" ? "bg-white/10 text-white" : "text-white/40"}`}>登录</button>
                  <button onClick={() => setMode("register")} className={`rounded py-1.5 ${mode === "register" ? "bg-white/10 text-white" : "text-white/40"}`}>注册</button>
                </div>
                <form onSubmit={submit} className="space-y-3">
                  <input type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="邮箱"
                    className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-indigo-400/60" />
                  <input type="password" required minLength={10} maxLength={128} autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="密码（至少 10 位）"
                    className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-indigo-400/60" />
                  {authError && <div className="text-xs text-red-300">{authError}</div>}
                  <button disabled={busy || checkingAuth} className="flex w-full items-center justify-center gap-2 rounded-md bg-indigo-500/70 py-2 text-sm font-medium text-white hover:bg-indigo-400/80 disabled:opacity-40">
                    <LogIn size={15} />{busy ? "请稍候…" : mode === "login" ? "登录" : "注册并登录"}
                  </button>
                  <div className="text-[11px] leading-relaxed text-white/35">邮箱目前仅作为登录名使用，不会公开展示。密码只保存加盐哈希。</div>
                </form>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
