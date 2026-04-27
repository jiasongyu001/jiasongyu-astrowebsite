import Link from "next/link";
import SkyMapWrapper from "./SkyMapWrapper";

export const metadata = {
  title: "全天深度曝光参考图 | My Space",
  description: "交互式全天深度曝光参考图，使用立体投影与精确WCS定位，支持拖动漫游、缩放和照片叠加",
};

export default function SkyMapPage() {
  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)]">
      {/* Header */}
      <div className="shrink-0 border-b border-border/40 bg-background/80 backdrop-blur-sm px-6 py-3">
        <div className="mx-auto max-w-7xl flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/category/survey"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              ← 深空巡天项目
            </Link>
            <span className="text-border">/</span>
            <h1 className="text-lg font-bold tracking-tight">全天深度曝光参考图</h1>
          </div>
          <div className="hidden sm:flex items-center gap-4 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-cyan-500/10 border border-cyan-500/20 px-2.5 py-0.5 text-cyan-400">
              立体投影
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-0.5 text-emerald-400">
              88 星座
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-500/10 border border-indigo-500/20 px-2.5 py-0.5 text-indigo-400">
              5070 颗恒星
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 border border-amber-500/20 px-2.5 py-0.5 text-amber-400">
              132 张深度曝光照片
            </span>
          </div>
        </div>
      </div>

      {/* Map fills remaining space */}
      <SkyMapWrapper />
    </div>
  );
}
