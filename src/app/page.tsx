import Link from "next/link";
import { categories, projects } from "@/lib/projects";

export default function Home() {
  return (
    <div className="flex flex-col">
      {/* Hero */}
      <section className="relative flex flex-col items-center justify-center px-6 py-24 sm:py-32 text-center">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-primary/10 via-transparent to-transparent" />
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
          探索 · 创造 · 分享
        </h1>
        <p className="mt-4 max-w-xl text-lg text-muted-foreground leading-relaxed">
          个人天文观测、摄影作品与技术项目空间
        </p>
      </section>

      {/* Category Grid */}
      <section className="mx-auto w-full max-w-5xl px-6 pb-20">
        <h2 className="mb-8 text-2xl font-bold tracking-tight text-center">
          主要方向
        </h2>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {categories.map((cat) => {
            const count = projects.filter((p) => p.category === cat.slug).length;
            return (
              <Link
                key={cat.slug}
                href={`/category/${cat.slug}`}
                className="group relative flex flex-col justify-between overflow-hidden rounded-xl border border-border/50 bg-card/50 p-6 transition-all duration-300 hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5"
              >
                <div className={`absolute inset-0 -z-10 bg-gradient-to-br ${cat.color} opacity-0 transition-opacity duration-300 group-hover:opacity-100`} />
                <div>
                  <span className="text-3xl">{cat.icon}</span>
                  <h3 className="mt-3 text-lg font-semibold tracking-tight group-hover:text-primary transition-colors">
                    {cat.title}
                  </h3>
                  <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                    {cat.description}
                  </p>
                </div>
                <div className="mt-4 flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    {count > 0 ? `${count} 篇内容` : "即将更新"}
                  </span>
                  <span className="text-sm text-muted-foreground transition-transform duration-200 group-hover:translate-x-1">
                    →
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}
