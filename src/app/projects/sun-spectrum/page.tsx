import Link from "next/link";
import SpectrumViewer from "./SpectrumViewer";

export const metadata = {
  title: "太阳高分辨率光谱 | My Space",
  description: "太阳高分辨率光谱图，展示太阳连续光谱中的精细吸收线（夫琅禾费线）。支持自由缩放与拖动查看细节。",
};

export default function SunSpectrumPage() {
  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)]">
      {/* Header */}
      <div className="shrink-0 border-b border-border/40 bg-background/80 backdrop-blur-sm px-6 py-3">
        <div className="mx-auto max-w-7xl flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/category/spectroscopy"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              ← 天文光谱
            </Link>
            <span className="text-border">/</span>
            <h1 className="text-lg font-bold tracking-tight">
              太阳高分辨率光谱
            </h1>
          </div>
          <div className="hidden sm:flex items-center gap-4 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-yellow-500/15 border border-yellow-500/30 px-3 py-0.5 text-yellow-300 font-medium">
              滚轮缩放 · 拖动漫游 · 捏合缩放
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-0.5 text-emerald-400">
              高分辨率原图
            </span>
          </div>
        </div>
      </div>

      {/* Viewer fills remaining space */}
      <SpectrumViewer />
    </div>
  );
}
