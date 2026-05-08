# CreatWebsite — 网站技术交接文档

> 最后更新: 2026-04-29  
> 技术栈: Next.js 16 + React 19 + Tailwind CSS 4 + shadcn/ui + Cloudflare Pages 静态部署

---

## 一、项目概述

个人天文项目展示网站，包含:
1. **首页**: 6 个分类方向卡片入口
2. **分类页**: 按类别列出项目（动态路由 `[slug]`）
3. **项目详情页**: 通用项目展示（动态路由 `[slug]`）
4. **全天深度曝光参考图**: 星图专用全屏页（`/projects/sky-map`）
5. **全部内容页**: 所有分类+项目总览
6. **关于页**: 个人介绍

**线上地址**:
- **域名**: jsyastro.com / www.jsyastro.com
- **Cloudflare Pages**: jiasongyu-astrowebsite.pages.dev
- **GitHub**: https://github.com/jiasongyu001/jiasongyu-astrowebsite
- **部署**: `git push origin main` → Cloudflare Pages 自动构建 (1-2 分钟生效)
- **域名注册**: 阿里云，Nameserver 已转至 Cloudflare (`alberto.ns.cloudflare.com` / `rosemary.ns.cloudflare.com`)

---

## 二、文件结构

```
d:\AI\windsurf_workspace\CreatWebsite\
├── package.json              # 依赖 (Next.js 16, React 19, shadcn, tailwind 4)
├── next.config.ts            # 静态导出配置 (output: "export")
├── tsconfig.json             # TS 配置 (strict, paths: @/* → ./src/*)
├── components.json           # shadcn 配置 (base-nova 风格, neutral 底色)
├── postcss.config.mjs        # PostCSS + Tailwind
├── eslint.config.mjs         # ESLint 配置
│
├── public/
│   ├── skymap/               # ★ 星图数据文件 (见第六节)
│   │   ├── stars.json        #   恒星数据 (~5070 颗)
│   │   ├── hip_map.json      #   HIP 编号→坐标映射
│   │   ├── metadata.json     #   132 张照片元数据
│   │   ├── pn_catalog.json   #   行星状星云 (~3800)
│   │   ├── snr_catalog.json  #   超新星遗迹 (~300)
│   │   ├── dso_catalog.json  #   深空天体 (~13550)
│   │   ├── previews/         #   WebP 预览图 (20"/px)
│   │   └── details/          #   WebP 高清图 (5"/px)
│   └── images/               # 通用图片资源
│
└── src/
    ├── app/                  # Next.js App Router 页面
    │   ├── layout.tsx        #   根布局 (Navbar + Footer)
    │   ├── page.tsx          #   首页 (Hero + 分类卡片)
    │   ├── globals.css       #   全局样式 (oklch 颜色系统, light/dark)
    │   ├── about/page.tsx    #   关于页
    │   ├── category/[slug]/page.tsx   # 分类详情页
    │   ├── projects/
    │   │   ├── page.tsx               # 全部内容页
    │   │   ├── [slug]/page.tsx        # 项目详情页 (通用模板)
    │   │   └── sky-map/
    │   │       ├── page.tsx           # ★ 星图专用页面 (全屏)
    │   │       └── SkyMapWrapper.tsx  # 客户端入口 (ErrorBoundary)
    │   └── favicon.ico
    │
    ├── components/
    │   ├── navbar.tsx         # 顶部导航栏 (sticky, 3 项)
    │   ├── footer.tsx         # 页脚 (© + 技术栈)
    │   ├── project-card.tsx   # 项目卡片组件
    │   ├── sky-map/
    │   │   ├── SkyMapCanvas.tsx    # ★ 星图核心 (~1400 行)
    │   │   ├── projection.ts       # 立体投影 + 银道坐标转换
    │   │   └── constellations.ts   # 88 星座连线数据
    │   └── ui/                # shadcn 基础组件
    │       ├── badge.tsx
    │       ├── button.tsx
    │       ├── card.tsx
    │       ├── navigation-menu.tsx
    │       └── separator.tsx
    │
    └── lib/
        ├── projects.ts        # 分类+项目数据定义
        └── utils.ts           # cn() 工具函数 (clsx + twMerge)
```

---

## 三、技术栈与配置

### 3.1 核心依赖

| 包 | 版本 | 用途 |
|----|------|------|
| `next` | 16.2.2 | 框架 (App Router, SSG) |
| `react` / `react-dom` | 19.2.4 | UI 库 |
| `tailwindcss` | 4.x | CSS (Tailwind v4, @import 语法) |
| `shadcn` | 4.1.2 | UI 组件库 (base-nova 风格) |
| `class-variance-authority` | 0.7.1 | 组件变体工具 |
| `clsx` + `tailwind-merge` | - | className 合并 |
| `lucide-react` | 1.7.0 | 图标库 |
| `tw-animate-css` | 1.4.0 | CSS 动画 |

### 3.2 Next.js 配置 (`next.config.ts`)

```ts
output: "export"              // 始终静态 HTML 导出
images: { unoptimized: true }  // 静态导出不支持 Image Optimization
allowedDevOrigins: ["127.0.0.1"]
```

构建产物: `out/` 目录（纯静态 HTML/CSS/JS）。

### 3.3 Cloudflare Pages 配置

通过 Cloudflare 控制台配置（无本地配置文件）:

| 设置项 | 值 |
|--------|-----|
| 生产分支 | `main` |
| 构建命令 | `npm run build` |
| 构建输出目录 | `out` |
| 环境变量 | `NODE_VERSION` = `20` |

### 3.4 TypeScript 配置

- `target`: ES2017
- `strict`: true
- `paths`: `@/*` → `./src/*`
- `jsx`: react-jsx

### 3.5 CSS 与主题 (`globals.css`)

- **颜色系统**: oklch（Tailwind v4 原生支持）
- **双主题**: `:root` (light) + `.dark` (dark)
- **当前模式**: `<html class="dark">` — **始终暗色模式**（在 layout.tsx 中硬编码）
- **关键颜色变量**: `--background`, `--foreground`, `--card`, `--primary`, `--muted-foreground` 等
- **圆角**: `--radius: 0.625rem`，各尺寸通过乘法系数派生

---

## 四、路由与页面

### 4.1 路由表

| 路径 | 文件 | 类型 | 说明 |
|------|------|------|------|
| `/` | `app/page.tsx` | 静态 | 首页: Hero + 6 分类卡片 |
| `/about` | `app/about/page.tsx` | 静态 | 关于我 |
| `/projects` | `app/projects/page.tsx` | 静态 | 全部内容总览 |
| `/projects/sky-map` | `app/projects/sky-map/page.tsx` | 静态 | ★ 星图全屏页 |
| `/projects/sun-spectrum` | `app/projects/sun-spectrum/page.tsx` | 静态 | 太阳高分辨率光谱（全屏查看器） |
| `/projects/[slug]` | `app/projects/[slug]/page.tsx` | SSG | 项目详情模板 |
| `/category/[slug]` | `app/category/[slug]/page.tsx` | SSG | 分类详情页 |

**所有页面均为静态生成** (`dynamicParams = false`)。

### 4.2 布局层级

```
RootLayout (layout.tsx)
├── <html lang="zh-CN" class="dark">
│   <body class="min-h-full flex flex-col bg-background text-foreground">
│     ├── <Navbar />          # sticky top-0 z-50, h-14
│     ├── <main class="flex-1">
│     │   └── {children}      # 页面内容
│     └── <Footer />          # border-t, © 版权
```

- **字体**: Geist Sans + Geist Mono (Google Fonts)
- **Navbar 高度**: 3.5rem (h-14)
- **星图页高度**: `h-[calc(100vh-3.5rem)]` — 减去 Navbar 高度，**不显示 Footer**

### 4.3 首页 (`page.tsx`)

```
Hero 区域:
  背景: radial-gradient from-primary/10
  标题: "探索 · 创造 · 分享"
  副标题: "个人天文观测、摄影作品与技术项目空间"

分类卡片 Grid (sm:2列, lg:3列):
  每个分类: icon + 标题 + 描述 + 项目数量
  hover: border-primary/30, shadow, 渐变背景显现
```

### 4.4 动态路由页面

**分类页** `/category/[slug]`:
- `generateStaticParams` → 从 `categories` 数组生成
- 显示该分类下所有项目列表
- 无项目时显示 🚧 占位

**项目详情页** `/projects/[slug]`:
- `generateStaticParams` → 从 `projects` 数组生成
- 显示: 图片 + 日期 + 标题 + tags + 描述 + GitHub/在线链接
- 当前只有 sky-map 一个实际项目

**注意**: sky-map 项目有**专属页面** (`projects/sky-map/page.tsx`)，不走通用的 `[slug]` 模板。Next.js 匹配规则: 精确路径优先于动态路由。

---

## 五、数据模型 (`lib/projects.ts`)

### 5.1 分类 (`Category`)

```ts
interface Category {
  slug: string;       // URL slug
  title: string;      // 显示标题
  description: string; // 简介
  icon: string;       // emoji
  color: string;      // Tailwind gradient class
}
```

**当前 6 个分类**:

| slug | 标题 | icon | 渐变 |
|------|------|------|------|
| `deep-sky` | 深空摄影作品 | 🌌 | indigo→purple |
| `planetary` | 行星摄影作品 | 🪐 | amber→orange |
| `survey` | 深空巡天项目 | 🔭 | cyan→blue |
| `spectroscopy` | 天文光谱 | 🌈 | emerald→teal |
| `education` | 天文竞赛教学 | 📚 | rose→pink |
| `equipment` | 天文设备测试 | ⚙️ | slate→zinc |

### 5.2 项目 (`Project`)

```ts
interface Project {
  slug: string;
  category: string;   // 关联 Category.slug
  title: string;
  description: string;
  tags: string[];
  date: string;
  image?: string;
  href?: string;       // 在线链接
  github?: string;     // GitHub 链接
}
```

**当前项目**:
- `sky-map` (归属 `survey` 分类，有专属全屏页面)
- `constellation-guide` (归属 `survey` 分类，有专属页面)
- `sun-spectrum` (归属 `spectroscopy` 分类，有专属全屏查看器页面)

### 5.3 添加新项目

在 `lib/projects.ts` 的 `projects` 数组中追加对象即可。如需专属页面（不走通用模板），在 `app/projects/` 下创建对应目录。

---

## 六、通用组件

### 6.1 `Navbar` (客户端组件)

```
<header sticky top-0 z-50, bg-background/80 backdrop-blur-md>
  左: 🚀 My Space (Link → /)
  右: [首页] [全部内容] [关于]
       当前页高亮: bg-accent text-accent-foreground
```

导航项定义在 `NAV_ITEMS` 数组中，通过 `usePathname()` 判断当前路由高亮。

### 6.2 `Footer`

简单版权行: `© {年份} My Space. Built with Next.js & Tailwind CSS.`

### 6.3 `ProjectCard`

使用 shadcn `Card` 组件，显示项目图片/标题/描述/tags。目前未直接使用（分类页自定义了卡片布局）。

### 6.4 shadcn UI 组件 (`components/ui/`)

| 组件 | 说明 |
|------|------|
| `Badge` | 标签徽章 (6 种 variant: default/secondary/destructive/outline/ghost/link) |
| `Button` | 按钮 (shadcn 标准) |
| `Card` | 卡片容器 (Card/CardHeader/CardTitle/CardDescription/CardContent/CardFooter) |
| `NavigationMenu` | 导航菜单 (已安装但未使用) |
| `Separator` | 分割线 |

### 6.5 `cn()` 工具函数

```ts
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

标准 shadcn 模式: 合并 className + 去重 Tailwind 类名冲突。

---

## 七、星图功能 (已在 DeepSkySurveyMap/HANDOVER.md 第十一节详细记录)

星图相关代码的完整交接文档见 `DeepSkySurveyMap/HANDOVER.md` 第十一节，包含:
- `projection.ts` — 投影函数 + 银道坐标转换
- `SkyMapCanvas.tsx` — ~1400 行完整结构分析（类型/状态/绘制/交互/UI）
- `SkyMapWrapper.tsx` — ErrorBoundary + SSR 延迟挂载
- `page.tsx` — Header 徽章布局
- 数据文件格式

此处仅做摘要:

### 7.1 文件关系

```
page.tsx (服务端, 全屏布局 + Header 徽章)
  └→ SkyMapWrapper.tsx (客户端, ErrorBoundary + mounted 延迟)
       └→ SkyMapCanvas.tsx (核心渲染 + UI + 交互)
            ├── import projection.ts (投影数学)
            └── import constellations.ts (星座数据)
```

### 7.2 功能清单

| 功能 | 状态 |
|------|------|
| 立体投影全天星图 | ✅ |
| 深空照片叠加 (preview 全量 + detail 按需加载) | ✅ |
| 天体目录 (PN/SNR/Messier/NGC/IC/Sh2) | ✅ |
| 两阶段搜索 (天体名 + 照片名) | ✅ |
| 赤道坐标网格 + 银道坐标网格 | ✅ |
| 坐标跳转 (RA/Dec + l/b) | ✅ |
| 鼠标坐标 (RA/Dec + l/b) | ✅ |
| 十字准星 | ✅ |
| 相机视场模拟器 + Mosaic | ✅ |
| 触屏捏合缩放 | ✅ |

### 7.3 Header 徽章 (page.tsx)

4 个静态徽章，**照片数量需手动更新**:
```
[立体投影(cyan)] [88星座(emerald)] [5070颗恒星(indigo)] [157张深度曝光照片(amber)]
```

### 7.4 坐标与搜索栏布局 (CoordJumpRow)

名称搜索、赤道坐标跳转、银道坐标跳转合并在同一行，三组之间用竖线分隔符分开。

```
[名称搜索] | [赤道坐标] RA(赤经) h m s  Dec(赤纬) ° ′ ″ [跳转] | [银道坐标] l(银经) °  b(银纬) ° [跳转]
```

### 7.5 相机视场模拟按钮

独立样式的高亮按钮（非普通 ToggleBtn）:
- **关闭状态**: 琥珀色描边 + 文字
- **开启状态**: 红色背景 + 发光阴影 `shadow-[0_0_8px_rgba(255,60,60,.4)]`

### 7.6 数据更新流程

```bash
# 1. 在桌面版处理新图片 (自动 plate solving + WCS)
# 2. 导出到网站
cd d:\AI\windsurf_workspace\DeepSkySurveyMap
python tools/export_web.py

# 3. 构建验证
cd d:\AI\windsurf_workspace\CreatWebsite
npx next build

# 4. 部署
git add -A && git commit -m "描述"
git -c http.proxy="" -c https.proxy="" push origin main
```

---

## 八、部署与构建

### 8.1 构建流程

```bash
npm run build   # → next build → 静态导出到 out/
```

产物结构:
```
out/
├── index.html             # 首页
├── about.html
├── projects.html
├── projects/sky-map.html  # 星图页
├── category/survey.html   # 等各分类
├── skymap/                # 数据文件 (从 public/ 复制)
└── _next/                 # JS/CSS 资源
```

### 8.2 Cloudflare Pages 部署

- **平台**: Cloudflare Pages（从 Netlify 迁移，2026-04-28）
- **触发**: push 到 GitHub `main` 分支
- **构建命令**: `npm run build`
- **发布目录**: `out`
- **环境变量**: `NODE_VERSION=20`
- **构建时间**: ~30 秒
- **生效时间**: 1-2 分钟
- **免费套餐**: 无带宽限制、500次构建/月、全球 300+ CDN 节点

**迁移原因**: Netlify 免费套餐带宽 100GB/月，星图页面单次访问数据量较大，容易超限。Cloudflare Pages 无带宽限制。

**域名配置**: 域名在阿里云购买，Nameserver 已改为 Cloudflare（`alberto.ns.cloudflare.com` / `rosemary.ns.cloudflare.com`），通过 Cloudflare Pages Custom Domain 绑定 `jsyastro.com` 和 `www.jsyastro.com`。

### 8.3 Git 代理问题

用户配置了 `http://127.0.0.1:7890` 代理，有时导致 push 失败（connection reset）。解决:

```bash
git -c http.proxy="" -c https.proxy="" push origin main
```

### 8.4 本地开发

```bash
cd d:\AI\windsurf_workspace\CreatWebsite
npm run dev    # → http://localhost:3000
```

**注意**: 开发模式下 `output: "export"` 不生效，所有路由正常工作。

---

## 九、设计规范

### 9.1 颜色

全站暗色模式 (`<html class="dark">`):

| 角色 | oklch 值 | 大致效果 |
|------|---------|---------|
| background | `0.145 0 0` | 深灰黑 |
| foreground | `0.985 0 0` | 近白 |
| card | `0.205 0 0` | 稍亮灰 |
| muted-foreground | `0.708 0 0` | 中灰(次要文本) |
| primary | `0.922 0 0` | 亮灰(强调) |
| border | `1 0 0 / 10%` | 极浅白边框 |

### 9.2 布局

- **最大宽度**: `max-w-5xl` (通用页面), `max-w-7xl` (星图 Header), `max-w-3xl` (文章)
- **内边距**: `px-6`
- **卡片圆角**: `rounded-xl`
- **卡片边框**: `border-border/50`, hover → `border-primary/30`

### 9.3 字体

- **正文**: Geist Sans (`--font-geist-sans`)
- **代码**: Geist Mono (`--font-geist-mono`)
- **坐标显示**: `font-mono` (等宽)

---

---

## 十、性能优化记录

### 10.1 图片加载策略优化 (2026-04-28)

**问题**: 原实现在页面打开时预加载所有 157 张 detail 高清图（343.2 MB），导致单次访问带宽消耗约 439 MB。

**修复**: 
- 删除 `preloadDetails` 预加载逻辑
- Detail 图片改为用户点击照片时才按需下载
- 加载时居中显示旋转 spinner + "加载高清图中..." + 目标名称

### 10.2 Preview 图片压缩 (2026-04-28)

**问题**: 157 张 preview 图片总计 94.6 MB。

**修复**: 使用 `DeepSkySurveyMap/tools/compress_previews.py` 重新编码 WebP：
- 大于 300KB 的文件降低质量 (70→25) + 必要时缩小分辨率
- 压缩后: **94.6 MB → 22.1 MB**（降低 77%）
- 视觉影响在星图缩放状态下基本不可感知

### 10.3 优化前后对比

| | 优化前 | 优化后 |
|--|--------|--------|
| Preview 图片 | 94.6 MB | 22.1 MB |
| Detail 预加载 | 343.2 MB (自动) | 0 MB (按需) |
| 单次访问带宽 | ~439 MB | ~23 MB |
| 节省 | — | ~95% |

---

## 十一、已知约束与注意事项

1. **静态导出**: 无服务端功能（API routes、middleware、ISR 均不可用）
2. **图片未优化**: `images: { unoptimized: true }` — 不使用 Next.js Image Optimization
3. **照片数量硬编码**: page.tsx Header 中的 "157 张" 需手动更新
4. **分类内容**: `survey` 下有 2 个项目，`spectroscopy` 下有 1 个项目，其余分类为空
5. **sky-map JSON 数据**: 首次加载需下载 ~1.2 MB JSON 数据
6. **preview 图片**: 157 张 WebP 文件共约 22 MB，页面打开时全量加载
7. **detail 图片**: 157 张共约 343 MB，用户点击时按需加载单张 (3-8 MB)
8. **constellations.ts**: 纯数据文件，88 星座 HIP 编号对，不需要频繁修改
9. **shadcn 组件**: 部分组件已安装但未使用（NavigationMenu）
10. **触屏支持**: SkyMapCanvas 支持捏合缩放，但拖动在某些移动端可能与浏览器滚动冲突

---

## 十二、更新日志

1. **左侧栏布局重构**: SkyMapCanvas 从顶部横条布局改为左侧边栏（300px）+ 右侧 canvas 的水平布局。侧边栏纵向排列：鼠标坐标显示、天体目录切换、坐标网格切换、名称搜索、赤道/银道坐标跳转（RA 一行 Dec 一行）、相机视场模拟（按钮+展开面板）。Canvas 使用 ResizeObserver 实时追踪容器大小变化。
2. **操作提示移至顶部**: "滚轮缩放·拖动漫游·单击切换分辨率" 从侧边栏底部移到 page.tsx Header 中以黄色醒目徽章显示。
3. **图片自动重绘**: overlay 图片添加 `onload` 回调，加载完成后自动触发 canvas 重绘，无需手动拖动即可显示所有照片。
4. **太阳高分辨率光谱页面**: 新增 `spectroscopy` 分类下第一个项目。专属全屏查看器页面 (`/projects/sun-spectrum`)，使用 `SpectrumViewer.tsx` 客户端组件实现鼠标滚轮缩放（向光标位置缩放）、拖动漫游、触屏捏合缩放。图片为高分辨率原图 (~17MB)，存放于 `public/images/spectrum/SunSpectrum.png`。
