"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, Database, RefreshCw, ShieldAlert } from "lucide-react";
import { useUserData } from "@/components/user-data-provider";
import type { CameraCandidateTarget, CameraConfig, UserDocument } from "@/lib/user-data";

type AdminUserData = {
  id: string;
  username: string;
  createdAt: string;
  lastLoginAt: string | null;
  updatedAt: string | null;
  document: Partial<UserDocument> | { error: string } | null;
};

function dateText(value: string | null): string {
  if (!value) return "无";
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function cameraName(entry: CameraConfig, index: number): string {
  return entry.name?.trim() || `${entry.focal || 0}mm 视场 ${index + 1}`;
}

function candidateGroups(entries: CameraConfig[], candidates: CameraCandidateTarget[]) {
  return entries.map((entry, index) => ({
    entry,
    index,
    candidates: candidates.filter((target) => target.cameraId === entry.id || (!target.cameraId && index === 0)),
  }));
}

export default function AdminDataPage() {
  const { user, checkingAuth } = useUserData();
  const [users, setUsers] = useState<AdminUserData[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/users");
      const payload = await response.json() as { users?: AdminUserData[]; error?: string };
      if (!response.ok) throw new Error(payload.error || `请求失败（${response.status}）`);
      setUsers(payload.users ?? []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法读取用户数据");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user?.isAdmin) void load();
  }, [user?.isAdmin]);

  const totals = useMemo(() => users.reduce((summary, item) => {
    const document = item.document && !("error" in item.document) ? item.document : null;
    summary.cameras += document?.cameraEntries?.length ?? 0;
    summary.candidates += document?.cameraCandidateTargets?.length ?? 0;
    return summary;
  }, { cameras: 0, candidates: 0 }), [users]);

  if (checkingAuth) return <div className="mx-auto max-w-6xl px-5 py-12 text-sm text-white/45">正在验证管理员权限…</div>;

  if (!user?.isAdmin) {
    return (
      <div className="mx-auto max-w-3xl px-5 py-16">
        <div className="flex items-center gap-3 border-b border-white/10 pb-4 text-red-200">
          <ShieldAlert size={22} />
          <h1 className="text-xl font-semibold">无管理员权限</h1>
        </div>
        <p className="mt-4 text-sm text-white/45">请使用管理员用户名登录后访问此页面。</p>
        <Link href="/" className="mt-6 inline-block text-sm text-indigo-300 hover:text-indigo-200">返回首页</Link>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-white/10 pb-5">
        <div>
          <div className="flex items-center gap-2 text-cyan-200"><Database size={20} /><span className="text-sm">管理员</span></div>
          <h1 className="mt-2 text-2xl font-semibold">用户数据管理</h1>
          <p className="mt-1 text-sm text-white/40">只读查看用户视场与候选目标，不显示任何登录凭据。</p>
        </div>
        <button onClick={() => void load()} disabled={loading}
          className="inline-flex items-center gap-2 rounded border border-white/10 px-3 py-2 text-sm text-white/65 hover:bg-white/5 disabled:opacity-35">
          <RefreshCw size={15} className={loading ? "animate-spin" : ""} />刷新
        </button>
      </div>

      <div className="grid grid-cols-3 gap-px border-b border-white/10 bg-white/10">
        {[
          ["用户", users.length],
          ["视场", totals.cameras],
          ["候选目标", totals.candidates],
        ].map(([label, value]) => (
          <div key={label} className="bg-background px-4 py-4">
            <div className="text-2xl font-semibold text-white/85">{value}</div>
            <div className="mt-1 text-xs text-white/35">{label}</div>
          </div>
        ))}
      </div>

      {error && <div className="mt-5 border-l-2 border-red-400 bg-red-400/5 px-4 py-3 text-sm text-red-200">{error}</div>}

      <div className="mt-6 overflow-hidden border border-white/10">
        <div className="grid grid-cols-[minmax(9rem,1fr)_repeat(4,minmax(7rem,auto))] gap-3 border-b border-white/10 bg-white/[.035] px-4 py-2 text-xs text-white/35">
          <span>用户名</span><span>注册时间</span><span>最后登录</span><span>视场</span><span>候选目标</span>
        </div>
        {users.map((item) => {
          const document = item.document && !("error" in item.document) ? item.document : null;
          const entries = document?.cameraEntries ?? [];
          const candidates = document?.cameraCandidateTargets ?? [];
          const groups = candidateGroups(entries, candidates);
          const isExpanded = Boolean(expanded[item.id]);
          return (
            <div key={item.id} className="border-b border-white/7 last:border-b-0">
              <button onClick={() => setExpanded((current) => ({ ...current, [item.id]: !isExpanded }))}
                className="grid w-full grid-cols-[minmax(9rem,1fr)_repeat(4,minmax(7rem,auto))] items-center gap-3 px-4 py-3 text-left text-sm hover:bg-white/[.025]">
                <span className="flex min-w-0 items-center gap-2 font-medium text-white/80">
                  {isExpanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                  <span className="truncate">{item.username}</span>
                </span>
                <span className="text-xs text-white/40">{dateText(item.createdAt)}</span>
                <span className="text-xs text-white/40">{dateText(item.lastLoginAt)}</span>
                <span className="text-white/55">{entries.length}</span>
                <span className="text-white/55">{candidates.length}</span>
              </button>
              {isExpanded && (
                <div className="border-t border-white/7 bg-black/15 px-4 py-4">
                  <div className="mb-3 text-xs text-white/30">数据更新时间：{dateText(item.updatedAt)}</div>
                  {groups.length === 0 && <div className="py-5 text-center text-sm text-white/30">该用户尚未保存视场</div>}
                  <div className="space-y-3">
                    {groups.map(({ entry, index, candidates: cameraCandidates }) => (
                      <div key={entry.id || index} className="border-l-2 border-cyan-300/25 bg-white/[.025] px-3 py-3">
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                          <span className="font-medium text-white/75">{cameraName(entry, index)}</span>
                          <span className="text-xs text-white/35">f {entry.focal}mm · {entry.sw}×{entry.sh}mm · Mosaic {entry.mosX}×{entry.mosY}</span>
                          {entry.hidden && <span className="text-xs text-amber-200/55">视场已隐藏</span>}
                        </div>
                        <div className="mt-2 space-y-1">
                          {cameraCandidates.length === 0 && <div className="text-xs text-white/25">无候选目标</div>}
                          {cameraCandidates.map((target) => (
                            <div key={target.id} className="grid grid-cols-[minmax(8rem,1fr)_auto_auto] gap-3 border-t border-white/5 pt-1.5 text-xs">
                              <span className="truncate text-white/60">{target.name}</span>
                              <span className="font-mono text-white/35">{target.ra.toFixed(5)}°, {target.dec.toFixed(5)}°</span>
                              <span className={target.hidden ? "text-amber-200/50" : "text-emerald-200/50"}>{target.hidden ? "已隐藏" : "显示中"}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {!loading && users.length === 0 && <div className="px-4 py-10 text-center text-sm text-white/30">暂无用户数据</div>}
      </div>
    </div>
  );
}
