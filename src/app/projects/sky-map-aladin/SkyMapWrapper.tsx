"use client";

import dynamic from "next/dynamic";
import { Component, type ReactNode } from "react";

const SkyMapCanvas = dynamic(() => import("@/components/sky-map-aladin/SkyMapCanvas"), {
  ssr: false,
  loading: () => (
    <div className="flex-1 flex items-center justify-center text-white/40">
      加载星图中...
    </div>
  ),
});

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

export default function SkyMapWrapper() {
  return (
    <ErrorBoundary>
      <div className="flex-1 min-h-0 flex flex-col">
        <SkyMapCanvas />
      </div>
    </ErrorBoundary>
  );
}
