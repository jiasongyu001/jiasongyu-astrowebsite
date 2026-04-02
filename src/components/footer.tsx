export function Footer() {
  return (
    <footer className="border-t border-border/40 py-8">
      <div className="mx-auto max-w-5xl px-6 text-center text-sm text-muted-foreground">
        <p>© {new Date().getFullYear()} My Space. Built with Next.js & Tailwind CSS.</p>
      </div>
    </footer>
  );
}
