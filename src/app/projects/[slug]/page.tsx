import { notFound } from "next/navigation";
import Link from "next/link";
import { projects } from "@/lib/projects";

export const dynamicParams = false;

export async function generateStaticParams() {
  return projects.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const project = projects.find((p) => p.slug === slug);
  if (!project) return { title: "未找到" };
  return {
    title: `${project.title} | My Space`,
    description: project.description,
  };
}

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const project = projects.find((p) => p.slug === slug);
  if (!project) notFound();

  return (
    <article className="mx-auto w-full max-w-3xl px-6 py-16">
      <Link
        href={`/category/${project.category}`}
        className="mb-6 inline-flex items-center text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        ← 返回分类
      </Link>

      {project.image && (
        <div className="mb-8 overflow-hidden rounded-lg border border-border/50">
          <img
            src={project.image}
            alt={project.title}
            className="w-full object-cover"
          />
        </div>
      )}

      <div className="space-y-4">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span>{project.date}</span>
        </div>

        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          {project.title}
        </h1>

        <div className="flex flex-wrap gap-2">
          {project.tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex h-5 items-center rounded-full bg-secondary px-2 text-xs font-medium text-secondary-foreground"
            >
              {tag}
            </span>
          ))}
        </div>

        <hr className="my-6 border-border" />

        <div className="prose prose-invert max-w-none text-muted-foreground leading-relaxed">
          <p>{project.description}</p>
          <p className="mt-4 text-sm italic text-muted-foreground/60">
            详细内容待补充。你可以编辑此页面来添加项目的完整介绍、截图、使用说明等。
          </p>
        </div>

        {(project.github || project.href) && (
          <div className="mt-8 flex gap-3">
            {project.github && (
              <a
                href={project.github}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-8 items-center justify-center rounded-lg border border-border bg-background px-3 text-sm font-medium transition-colors hover:bg-muted"
              >
                GitHub 源码
              </a>
            )}
            {project.href && (
              <a
                href={project.href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-8 items-center justify-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/80"
              >
                在线体验
              </a>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
