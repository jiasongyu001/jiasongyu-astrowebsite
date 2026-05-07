export interface Category {
  slug: string;
  title: string;
  description: string;
  icon: string;
  color: string;
}

export interface Project {
  slug: string;
  category: string;
  title: string;
  description: string;
  tags: string[];
  date: string;
  image?: string;
  href?: string;
  github?: string;
}

export const categories: Category[] = [
  {
    slug: "deep-sky",
    title: "深空摄影作品",
    description: "星云、星系、星团等深空天体的拍摄与后期处理作品集",
    icon: "🌌",
    color: "from-indigo-500/20 to-purple-500/20",
  },
  {
    slug: "planetary",
    title: "行星摄影作品",
    description: "太阳系行星、月球及太阳的高分辨率摄影作品",
    icon: "🪐",
    color: "from-amber-500/20 to-orange-500/20",
  },
  {
    slug: "survey",
    title: "深空巡天项目",
    description: "系统性巡天观测、变星监测、小行星搜索等科研项目",
    icon: "🔭",
    color: "from-cyan-500/20 to-blue-500/20",
  },
  {
    slug: "spectroscopy",
    title: "天文光谱",
    description: "恒星光谱采集与分析、光谱仪搭建与标定",
    icon: "🌈",
    color: "from-emerald-500/20 to-teal-500/20",
  },
  {
    slug: "education",
    title: "天文竞赛教学",
    description: "天文奥赛备赛资料、教程、真题解析与学习路线",
    icon: "📚",
    color: "from-rose-500/20 to-pink-500/20",
  },
  {
    slug: "equipment",
    title: "天文设备测试",
    description: "望远镜、相机、赤道仪等天文设备的评测与对比",
    icon: "⚙️",
    color: "from-slate-500/20 to-zinc-500/20",
  },
];

export const projects: Project[] = [
  {
    slug: "sky-map",
    category: "survey",
    title: "全天深度曝光参考图",
    description:
      "交互式全天星图，采用立体投影（Stereographic），支持无边界拖动漫游、滚轮缩放。叠加显示已拍摄深空照片，精确 WCS 定位，可查看巡天覆盖进度。",
    tags: ["交互式", "立体投影", "WCS", "巡天"],
    date: "2026-04",
  },
  {
    slug: "constellation-guide",
    category: "survey",
    title: "星座是怎么划分的？",
    description:
      "交互式全天星图，可分别显示现代88星座连线、中国古代星官连线、直观亮星连线三种图层，对比不同文化与算法下的星空划分方式。支持拖动漫游和滚轮缩放。",
    tags: ["交互式", "星座", "星官", "立体投影"],
    date: "2026-05",
  },
];
