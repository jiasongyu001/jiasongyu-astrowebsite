"use client";

import { useState, useEffect, Component, type ReactNode } from "react";
import ConstellationCanvas from "@/components/constellation-guide/ConstellationCanvas";

class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: string | null }
> {
  state = { error: null as string | null };
  static getDerivedStateFromError(err: Error) {
    return { error: err.message + "\n" + err.stack };
  }
  render() {
    if (this.state.error)
      return (
        <pre className="p-4 text-red-400 text-xs whitespace-pre-wrap overflow-auto">
          {this.state.error}
        </pre>
      );
    return this.props.children;
  }
}

export default function ConstellationWrapper() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="flex-1 flex items-center justify-center text-white/40">
        加载星图中...
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <div className="flex-1 min-h-0 flex flex-col">
        <ConstellationCanvas />
      </div>
    </ErrorBoundary>
  );
}
