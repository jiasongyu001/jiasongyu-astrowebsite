import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Vercel 自动设置 VERCEL 环境变量 → 动态模式
  // 其他平台（Cloudflare 等）→ 静态导出
  ...(!process.env.VERCEL
    ? { output: "export", images: { unoptimized: true } }
    : {}),
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
