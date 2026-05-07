import Link from "next/link";
import ConstellationWrapper from "./ConstellationWrapper";

export const metadata = {
  title: "星座是怎么划分的？ | My Space",
  description: "交互式全天星图，对比现代88星座、中国古代星官、直观亮星连线三种星空划分方式",
};

export default function ConstellationGuidePage() {
  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)] overflow-hidden">
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
            <h1 className="text-lg font-bold tracking-tight">星座是怎么划分的？</h1>
          </div>
          <div className="hidden sm:flex items-center gap-4 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-yellow-500/15 border border-yellow-500/30 px-3 py-0.5 text-yellow-300 font-medium">
              滚轮缩放 · 拖动漫游
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-cyan-500/10 border border-cyan-500/20 px-2.5 py-0.5 text-cyan-400">
              88 星座
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/10 border border-red-500/20 px-2.5 py-0.5 text-red-400">
              318 星官
            </span>
          </div>
        </div>
      </div>

      {/* Canvas fills remaining space */}
      <ConstellationWrapper />
    </div>
  );
}
