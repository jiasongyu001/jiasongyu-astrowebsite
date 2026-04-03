import { notFound } from "next/navigation";
import Link from "next/link";
import { categories, projects } from "@/lib/projects";

export const dynamicParams = false;

export async function generateStaticParams() {
  return categories.map((c) => ({ slug: c.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const cat = categories.find((c) => c.slug === slug);
  if (!cat) return { title: "未找到" };
  return {
    title: `${cat.title} | My Space`,
    description: cat.description,
  };
}

export default async function CategoryPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const cat = categories.find((c) => c.slug === slug);
  if (!cat) notFound();

  const items = projects.filter((p) => p.category === slug);

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-16">
      <Link
        href="/"
        className="mb-6 inline-flex items-center text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        ← 返回首页
      </Link>

      <div className="mb-10">
        <div className="flex items-center gap-3">
          <span className="text-4xl">{cat.icon}</span>
          <h1 className="text-3xl font-bold tracking-tight">{cat.title}</h1>
        </div>
        <p className="mt-3 text-muted-foreground leading-relaxed">
          {cat.description}
        </p>
      </div>

      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/50 py-20 text-center">
          <span className="text-4xl">🚧</span>
          <p className="mt-4 text-lg font-medium">内容建设中</p>
          <p className="mt-1 text-sm text-muted-foreground">
            这个板块正在准备中，敬请期待
          </p>
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2">
          {items.map((project) => (
            <Link
              key={project.slug}
              href={`/projects/${project.slug}`}
              className="group flex flex-col overflow-hidden rounded-xl border border-border/50 bg-card/50 transition-all duration-300 hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5"
            >
              {project.image && (
                <div className="relative aspect-video w-full overflow-hidden bg-muted">
                  <img
                    src={project.image}
                    alt={project.title}
                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                </div>
              )}
              <div className="flex flex-1 flex-col p-5">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold tracking-tight group-hover:text-primary transition-colors">
                    {project.title}
                  </h3>
                  <span className="text-xs text-muted-foreground">
                    {project.date}
                  </span>
                </div>
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                  {project.description}
                </p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {project.tags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex h-5 items-center rounded-full bg-secondary px-2 text-xs font-medium text-secondary-foreground"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
