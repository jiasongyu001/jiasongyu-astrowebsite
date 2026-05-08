"use client";

import { useRef, useState, useCallback, useEffect } from "react";

const MAX_SCALE = 3.0;   // 300%
const ZOOM_STEP = 1.12;

export default function SpectrumViewer() {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  // transform state: image top-left = (tx, ty), pixel size = scale
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // refs for use inside non-react event handlers
  const dragRef = useRef({ active: false, startX: 0, startY: 0 });
  const stateRef = useRef({ scale: 1, tx: 0, ty: 0, minScale: 0.1 });

  // keep refs in sync
  useEffect(() => {
    stateRef.current.scale = scale;
    stateRef.current.tx = tx;
    stateRef.current.ty = ty;
  }, [scale, tx, ty]);

  // compute the min scale so the whole image fits in the container
  const getMinScale = useCallback(() => {
    const c = containerRef.current;
    const img = imgRef.current;
    if (!c || !img || !img.naturalWidth) return 0.01;
    return Math.min(c.clientWidth / img.naturalWidth, c.clientHeight / img.naturalHeight);
  }, []);

  // fit image centered in container
  const fitToContainer = useCallback(() => {
    const c = containerRef.current;
    const img = imgRef.current;
    if (!c || !img || !img.naturalWidth) return;
    const s = getMinScale();
    stateRef.current.minScale = s;
    setScale(s);
    setTx((c.clientWidth - img.naturalWidth * s) / 2);
    setTy((c.clientHeight - img.naturalHeight * s) / 2);
  }, [getMinScale]);

  useEffect(() => {
    if (loaded) fitToContainer();
  }, [loaded, fitToContainer]);

  // recalc minScale on resize
  useEffect(() => {
    const c = containerRef.current;
    if (!c) return;
    const ro = new ResizeObserver(() => {
      stateRef.current.minScale = getMinScale();
    });
    ro.observe(c);
    return () => ro.disconnect();
  }, [getMinScale]);

  // ---- zoom towards mouse (native wheel, non-passive) ----
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      // mouse position in container coords
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      const { scale: s, tx: curTx, ty: curTy, minScale } = stateRef.current;
      const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      const next = Math.min(MAX_SCALE, Math.max(minScale, s * factor));
      if (next === s) return;
      const r = next / s;

      // zoom towards mouse: keep image point under cursor fixed
      const newTx = mx - r * (mx - curTx);
      const newTy = my - r * (my - curTy);

      setScale(next);
      setTx(newTx);
      setTy(newTy);
    };

    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, []);

  // ---- pointer drag ----
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    dragRef.current = {
      active: true,
      startX: e.clientX - stateRef.current.tx,
      startY: e.clientY - stateRef.current.ty,
    };
    setDragging(true);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current.active) return;
    setTx(e.clientX - dragRef.current.startX);
    setTy(e.clientY - dragRef.current.startY);
  }, []);

  const onPointerUp = useCallback(() => {
    dragRef.current.active = false;
    setDragging(false);
  }, []);

  // ---- touch pinch zoom ----
  const lastTouchDist = useRef<number | null>(null);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      lastTouchDist.current = Math.hypot(dx, dy);
    }
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2 && lastTouchDist.current !== null) {
      e.preventDefault();
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      const factor = dist / lastTouchDist.current;
      lastTouchDist.current = dist;

      const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
      const my = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;

      const { scale: s, tx: curTx, ty: curTy, minScale } = stateRef.current;
      const next = Math.min(MAX_SCALE, Math.max(minScale, s * factor));
      const r = next / s;

      setScale(next);
      setTx(mx - r * (mx - curTx));
      setTy(my - r * (my - curTy));
    }
  }, []);

  const onTouchEnd = useCallback(() => {
    lastTouchDist.current = null;
  }, []);

  // ---- button helpers ----
  const zoomIn = () => {
    const c = containerRef.current;
    if (!c) return;
    const { scale: s, tx: curTx, ty: curTy } = stateRef.current;
    const next = Math.min(MAX_SCALE, s * ZOOM_STEP);
    const r = next / s;
    const cx = c.clientWidth / 2;
    const cy = c.clientHeight / 2;
    setScale(next);
    setTx(cx - r * (cx - curTx));
    setTy(cy - r * (cy - curTy));
  };
  const zoomOut = () => {
    const c = containerRef.current;
    if (!c) return;
    const { scale: s, tx: curTx, ty: curTy, minScale } = stateRef.current;
    const next = Math.max(minScale, s / ZOOM_STEP);
    const r = next / s;
    const cx = c.clientWidth / 2;
    const cy = c.clientHeight / 2;
    setScale(next);
    setTx(cx - r * (cx - curTx));
    setTy(cy - r * (cy - curTy));
  };
  const resetView = () => fitToContainer();

  const pct = Math.round(scale * 100);

  return (
    <div className="relative flex-1 overflow-hidden bg-black select-none">
      {/* zoom controls */}
      <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5 rounded-lg bg-background/80 backdrop-blur-md border border-border/50 px-2 py-1 text-xs">
        <button
          onClick={zoomOut}
          className="px-1.5 py-0.5 rounded hover:bg-muted transition-colors font-mono"
          title="缩小"
        >
          −
        </button>
        <span className="min-w-[3.5rem] text-center font-mono text-muted-foreground">
          {pct}%
        </span>
        <button
          onClick={zoomIn}
          className="px-1.5 py-0.5 rounded hover:bg-muted transition-colors font-mono"
          title="放大"
        >
          +
        </button>
        <span className="mx-1 h-4 w-px bg-border/50" />
        <button
          onClick={resetView}
          className="px-1.5 py-0.5 rounded hover:bg-muted transition-colors"
          title="适应窗口"
        >
          适应
        </button>
      </div>

      {/* loading spinner */}
      {!loaded && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
          <span className="text-sm text-muted-foreground">
            加载高分辨率光谱图中…
          </span>
        </div>
      )}

      {/* image canvas area */}
      <div
        ref={containerRef}
        className="h-full w-full overflow-hidden"
        style={{ cursor: dragging ? "grabbing" : "grab", touchAction: "none" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <img
          ref={imgRef}
          src="/images/spectrum/SunSpectrum.png"
          alt="太阳高分辨率光谱"
          draggable={false}
          onLoad={() => setLoaded(true)}
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            transformOrigin: "0 0",
            transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
            willChange: "transform",
          }}
          className={`max-w-none transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"}`}
        />
      </div>
    </div>
  );
}
