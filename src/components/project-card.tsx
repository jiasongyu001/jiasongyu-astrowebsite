import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { Project } from "@/lib/projects";

export function ProjectCard({ project }: { project: Project }) {
  return (
    <Link href={`/projects/${project.slug}`} className="group block">
      <Card className="h-full overflow-hidden border-border/50 bg-card/50 transition-all duration-300 hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5">
        {project.image && (
          <div className="relative aspect-video w-full overflow-hidden bg-muted">
            <div className="absolute inset-0 bg-gradient-to-t from-card/80 to-transparent z-10" />
            <img
              src={project.image}
              alt={project.title}
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
            />
          </div>
        )}
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg leading-tight group-hover:text-primary transition-colors">
              {project.title}
            </CardTitle>
            <span className="text-xs text-muted-foreground">{project.date}</span>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <CardDescription className="text-sm leading-relaxed">
            {project.description}
          </CardDescription>
          <div className="flex flex-wrap gap-1.5">
            {project.tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex h-5 items-center rounded-full bg-secondary px-2 text-xs font-medium text-secondary-foreground"
              >
                {tag}
              </span>
            ))}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
