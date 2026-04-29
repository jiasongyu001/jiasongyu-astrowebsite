# AI 接手指南 — CreatWebsite（天文网站项目）

> 本文档供新 AI 助手快速了解项目，开始工作前请先阅读。

---

## 项目简介

个人天文项目展示网站，核心功能是**全天深空照片参考星图**（Canvas 交互式星图）。

- **线上地址**: https://jsyastro.com
- **Cloudflare Pages**: https://jiasongyu-astrowebsite.pages.dev
- **GitHub**: https://github.com/jiasongyu001/jiasongyu-astrowebsite
- **技术栈**: Next.js 16 + React 19 + Tailwind CSS 4 + shadcn/ui
- **部署方式**: `git push origin main` → Cloudflare Pages 自动构建

---

## 快速上手

```bash
# 安装依赖
npm install

# 本地开发
npm run dev         # http://localhost:3000

# 构建验证
npm run build       # 静态导出到 out/

# 部署（推送即部署）
git add -A
git commit -m "描述"
git -c http.proxy="" -c https.proxy="" push origin main
```

---

## 关键文件

| 文件 | 说明 |
|------|------|
| `HANDOVER.md` | **★ 完整技术交接文档**（必读，包含所有细节） |
| `src/components/sky-map/SkyMapCanvas.tsx` | 星图核心组件 (~1410 行) |
| `src/components/sky-map/projection.ts` | 立体投影 + 银道坐标转换 |
| `src/components/sky-map/constellations.ts` | 88 星座连线数据 |
| `src/lib/projects.ts` | 分类和项目数据定义 |
| `src/app/projects/sky-map/page.tsx` | 星图页面入口 |
| `public/skymap/` | 星图数据文件 + 预览/高清图片 |
| `next.config.ts` | 始终静态导出 (`output: "export"`) |
| `package.json` | 依赖定义 |

---

## 关联项目

桌面版星图程序在同级目录：
```
..\DeepSkySurveyMap\          # Python + PyQt6 桌面版
..\DeepSkySurveyMap\HANDOVER.md  # 桌面版完整交接文档
```

桌面版用于处理天文照片（plate solving + WCS 定位），处理完后通过 `tools/export_web.py` 导出数据到本项目的 `public/skymap/`。

---

## 重要注意事项

1. **静态站点**: 无服务端功能，所有页面预渲染为 HTML
2. **图片加载策略**: Preview 全量加载 (~22MB)，Detail 按需加载（用户点击时下载）
3. **Git 代理**: push 时如报错 connection reset，用 `git -c http.proxy="" -c https.proxy="" push origin main`
4. **照片数量硬编码**: `page.tsx` Header 中的照片数量需手动更新
5. **Cloudflare Pages 配置**: 构建命令 `npm run build`，输出目录 `out`，环境变量 `NODE_VERSION=20`

---

## 深入了解

阅读 `HANDOVER.md` 获取完整信息，包括：
- 所有路由和页面结构
- SkyMapCanvas.tsx 组件完整分析
- 搜索系统实现
- CSS 主题和设计规范
- 性能优化记录
- 数据更新流程
