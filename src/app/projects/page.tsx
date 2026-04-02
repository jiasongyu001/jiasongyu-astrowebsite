import Link from "next/link";
import { categories, projects } from "@/lib/projects";

export const metadata = {
  title: "所有内容 | My Space",
  description: "按分类浏览所有天文内容",
};

export default function ProjectsPage() {
  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-16">
      <div className="mb-10">
        <h1 className="text-3xl font-bold tracking-tight">所有内容</h1>
        <p className="mt-2 text-muted-foreground">
          按分类浏览全部天文内容
        </p>
      </div>

      <div className="space-y-12">
        {categories.map((cat) => {
          const items = projects.filter((p) => p.category === cat.slug);
          return (
            <section key={cat.slug}>
              <div className="mb-4 flex items-center justify-between">
                <Link
                  href={`/category/${cat.slug}`}
                  className="flex items-center gap-2 group"
                >
                  <span className="text-2xl">{cat.icon}</span>
                  <h2 className="text-xl font-bold tracking-tight group-hover:text-primary transition-colors">
                    {cat.title}
                  </h2>
                </Link>
                <Link
                  href={`/category/${cat.slug}`}
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  查看全部 →
                </Link>
              </div>

              {items.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border/50 py-8 text-center text-sm text-muted-foreground">
                  即将更新
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  {items.map((project) => (
                    <Link
                      key={project.slug}
                      href={`/projects/${project.slug}`}
                      className="group rounded-lg border border-border/50 bg-card/50 p-4 transition-all hover:border-primary/30"
                    >
                      <h3 className="font-medium group-hover:text-primary transition-colors">
                        {project.title}
                      </h3>
                      <p className="mt-1 text-sm text-muted-foreground line-clamp-2">
                        {project.description}
                      </p>
                    </Link>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
