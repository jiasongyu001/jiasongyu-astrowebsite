
export const metadata = {
  title: "关于 | My Space",
  description: "关于我和这个网站",
};

export default function AboutPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-16">
      <h1 className="text-3xl font-bold tracking-tight">关于我</h1>
      <p className="mt-3 text-muted-foreground leading-relaxed">
        欢迎来到我的个人空间。
      </p>

      <hr className="my-8 border-border" />

      <div className="space-y-6 text-muted-foreground leading-relaxed">
        <section>
          <h2 className="mb-3 text-xl font-semibold text-foreground">🔭 兴趣方向</h2>
          <ul className="list-disc list-inside space-y-1">
            <li>天文观测与数据处理</li>
            <li>桌面应用 & 工具开发</li>
            <li>数据可视化</li>
            <li>Web 开发与创意项目</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-3 text-xl font-semibold text-foreground">🛠️ 技术栈</h2>
          <ul className="list-disc list-inside space-y-1">
            <li>Python (PyQt6, Matplotlib, NumPy)</li>
            <li>TypeScript / JavaScript (Next.js, React)</li>
            <li>天文工具 (Astrometry.net, HYG Database, Stellarium)</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-3 text-xl font-semibold text-foreground">📬 联系方式</h2>
          <p>
            如有问题或合作意向，欢迎通过以下方式联系我：
          </p>
          <ul className="mt-2 list-disc list-inside space-y-1">
            <li>Email: your-email@example.com</li>
            <li>GitHub: github.com/your-username</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
