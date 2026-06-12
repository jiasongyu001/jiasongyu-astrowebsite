"use client";

import { useEffect, useState } from "react";
import { LogIn, LogOut, ShieldCheck, UserRound, X } from "lucide-react";
import { useUserData } from "@/components/user-data-provider";

export function AccountMenu() {
  const { user, checkingAuth, syncStatus, authError, login, logout } = useUserData();
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [registrationCode, setRegistrationCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [stats, setStats] = useState<{ totalUsers: number; activeSessions: number } | null>(null);

  useEffect(() => {
    if (!open || !user?.isAdmin) return;
    fetch("/api/admin/stats").then((response) => response.ok ? response.json() : null).then(setStats).catch(() => setStats(null));
  }, [open, user]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    await login(username, registrationCode);
    setBusy(false);
  };

  return (
    <>
      <button
        type="button"
        title={user ? "账户与云同步" : "用户名登录"}
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
                <div className="font-semibold">{user ? "账户与云同步" : "用户名登录"}</div>
                <div className="mt-0.5 text-xs text-white/40">视场、收藏和星图状态将跨设备同步</div>
              </div>
              <button title="关闭" onClick={() => setOpen(false)} className="rounded p-1 text-white/45 hover:bg-white/10 hover:text-white"><X size={17} /></button>
            </div>

            {user ? (
              <div className="space-y-4">
                <div className="rounded-md border border-white/8 bg-white/[.03] p-3">
                  <div className="text-sm text-white/85">{user.username}</div>
                  <div className="mt-1 text-xs text-white/40">
                    {syncStatus === "saving" ? "正在同步…" : syncStatus === "error" ? "同步失败，将在下次更改时重试" : "云端数据已同步"}
                  </div>
                </div>
                {user.isAdmin && (
                  <div className="rounded-md border border-cyan-400/20 bg-cyan-400/5 p-3">
                    <div className="mb-2 flex items-center gap-2 text-sm text-cyan-200"><ShieldCheck size={15} />管理员统计</div>
                    <div className="grid grid-cols-2 gap-2 text-center">
                      <div className="rounded bg-black/20 p-2"><div className="text-lg font-semibold">{stats?.totalUsers ?? "–"}</div><div className="text-[11px] text-white/40">用户名数量</div></div>
                      <div className="rounded bg-black/20 p-2"><div className="text-lg font-semibold">{stats?.activeSessions ?? "–"}</div><div className="text-[11px] text-white/40">有效会话</div></div>
                    </div>
                  </div>
                )}
                <button onClick={logout} className="flex w-full items-center justify-center gap-2 rounded-md border border-white/10 py-2 text-sm text-white/65 hover:bg-white/5 hover:text-white">
                  <LogOut size={15} />退出登录
                </button>
              </div>
            ) : (
              <form onSubmit={submit} className="space-y-3">
                <input type="text" required minLength={2} maxLength={32} autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="输入用户名"
                  className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-indigo-400/60" />
                <input type="text" value={registrationCode} onChange={(event) => setRegistrationCode(event.target.value)} placeholder="新用户注册码（已有用户可留空）"
                  className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-indigo-400/60" />
                {authError && <div className="text-xs text-red-300">{authError}</div>}
                <button disabled={busy || checkingAuth} className="flex w-full items-center justify-center gap-2 rounded-md bg-indigo-500/70 py-2 text-sm font-medium text-white hover:bg-indigo-400/80 disabled:opacity-40">
                  <LogIn size={15} />{busy ? "请稍候…" : "进入"}
                </button>
                <div className="text-[11px] leading-relaxed text-white/35">首次创建用户名需要填写注册码；之后输入同一用户名即可继续使用，无需再次填写。任何知道用户名的人都可以进入该空间。</div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
