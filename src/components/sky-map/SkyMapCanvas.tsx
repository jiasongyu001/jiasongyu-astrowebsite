"use client";

import { useRef, useEffect, useCallback, useState } from "react";
import { stereoFwd, stereoInv, makeCenter, computeScale } from "./projection";
import { CONSTELLATION_LINES } from "./constellations";
import type { ProjCenter } from "./projection";

/* ── types ── */
interface Star {
  ra: number;  // degrees
  dec: number;
  mag: number;
  hip?: number;
}

interface Overlay {
  name: string;
  ra: number;
  dec: number;
  corners: [number, number][];
  objects: string[];
  pixscale: number;
  orientation: number;
  field_w_deg: number;
  field_h_deg: number;
  img?: HTMLImageElement;       // preview (20"/px)
  detailImg?: HTMLImageElement; // detail (5"/px), loaded on demand
  showDetail?: boolean;         // true = currently showing detail
}

interface ConstellationSeg {
  ra1: number; dec1: number;
  ra2: number; dec2: number;
}

/* ── filename parser ── */
function parseFilename(name: string) {
  // Convention: Target_Fratio_Exposure_Author
  const parts = name.split("_");
  if (parts.length >= 4) {
    const author = parts[parts.length - 1];
    const exposure = parts[parts.length - 2];
    const telescope = parts[parts.length - 3];
    const target = parts.slice(0, parts.length - 3).join("_");
    return { target, telescope, exposure: exposure + "min", author };
  }
  return { target: name, telescope: "", exposure: "", author: "" };
}

/* ── constants ── */
const MAG_LIMIT = 6.0;
const MIN_FOV = 0.5;
const MAX_FOV = 180;

/* ── precompute star display props ── */
function starRadius(mag: number): number {
  const t = Math.max(0, (MAG_LIMIT - mag)) / (MAG_LIMIT + 1);
  return 1 + 5 * t * t;
}
function starAlpha(mag: number): number {
  return Math.min(255, Math.max(80, Math.round(80 + 175 * (1 - mag / MAG_LIMIT))));
}

export default function SkyMapCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  /* state kept in refs for animation-frame access */
  const centerRA = useRef(0);   // degrees
  const centerDec = useRef(30); // degrees
  const fov = useRef(120);      // degrees

  const stars = useRef<Star[]>([]);
  const constSegs = useRef<ConstellationSeg[]>([]);
  const overlays = useRef<Overlay[]>([]);
  const hipMap = useRef<Record<string, [number, number]>>({});

  const dragLast = useRef<{ x: number; y: number } | null>(null);
  const pressPos = useRef<{ x: number; y: number } | null>(null);
  const animId = useRef(0);
  const needsDraw = useRef(true);

  const [coordText, setCoordText] = useState("RA: --  Dec: --");
  const [hoverOverlay, setHoverOverlay] = useState<Overlay | null>(null);
  const [selectedOverlay, setSelectedOverlay] = useState<Overlay | null>(null);
  const [detailLoading, setDetailLoading] = useState<string | null>(null);

  /* ── load data ── */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [starsRes, hipRes, metaRes] = await Promise.all([
        fetch("/skymap/stars.json"),
        fetch("/skymap/hip_map.json"),
        fetch("/skymap/metadata.json"),
      ]);
      if (cancelled) return;

      const starsData: (number[])[] = await starsRes.json();
      stars.current = starsData.map((s) => ({
        ra: s[0], dec: s[1], mag: s[2], hip: s[3],
      }));

      hipMap.current = await hipRes.json();

      // Build constellation segments
      const segs: ConstellationSeg[] = [];
      for (const [, hips] of CONSTELLATION_LINES) {
        for (let i = 0; i < hips.length - 1; i += 2) {
          const s1 = hipMap.current[String(hips[i])];
          const s2 = hipMap.current[String(hips[i + 1])];
          if (!s1 || !s2) continue;
          segs.push({ ra1: s1[0], dec1: s1[1], ra2: s2[0], dec2: s2[1] });
        }
      }
      constSegs.current = segs;

      // Load overlays
      const metaData: Overlay[] = await metaRes.json();
      for (const ov of metaData) {
        const img = new Image();
        img.src = `/skymap/previews/${encodeURIComponent(ov.name)}.webp`;
        ov.img = img;
      }
      // Sort: larger field area first (so smaller images render on top)
      metaData.sort((a, b) => (b.field_w_deg * b.field_h_deg) - (a.field_w_deg * a.field_h_deg));
      overlays.current = metaData;
      needsDraw.current = true;

      // Preload all detail images in background (idle priority)
      const preloadDetails = () => {
        for (const ov of metaData) {
          if (!ov.detailImg) {
            const dimg = new Image();
            dimg.src = `/skymap/details/${encodeURIComponent(ov.name)}.webp`;
            dimg.onload = () => { needsDraw.current = true; };
            ov.detailImg = dimg;
          }
        }
      };
      if ('requestIdleCallback' in window) {
        (window as unknown as { requestIdleCallback: (cb: () => void) => void }).requestIdleCallback(preloadDetails);
      } else {
        setTimeout(preloadDetails, 2000);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  /* ── draw ── */
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const W = canvas.width;
    const H = canvas.height;
    const cx = W / 2;
    const cy = H / 2;
    const dpr = window.devicePixelRatio || 1;

    const c = makeCenter(centerRA.current, centerDec.current);
    const sc = computeScale(W, fov.current);

    // Background
    ctx.fillStyle = "#08080f";
    ctx.fillRect(0, 0, W, H);

    drawGraticule(ctx, sc, c, cx, cy, W, H);
    drawConstellations(ctx, sc, c, cx, cy, W, H);
    drawStars(ctx, sc, c, cx, cy, W, H);
    drawOverlays(ctx, sc, c, cx, cy, W, H);

    // FoV text
    ctx.fillStyle = "rgba(100,100,160,0.7)";
    ctx.font = `${12 * dpr}px sans-serif`;
    ctx.fillText(`FoV ${fov.current.toFixed(1)}°`, 8 * dpr, H - 8 * dpr);
  }, []);

  /* ── graticule ── */
  function drawGraticule(
    ctx: CanvasRenderingContext2D, sc: number, c: ProjCenter,
    cx: number, cy: number, W: number, H: number
  ) {
    ctx.strokeStyle = "rgba(34,34,68,0.6)";
    ctx.lineWidth = 1;

    // RA lines every 2h
    for (let raH = 0; raH < 24; raH += 2) {
      const raDeg = raH * 15;
      ctx.beginPath();
      let penDown = false;
      for (let dec = -90; dec <= 90; dec += 2) {
        const [x, y, cc] = stereoFwd(raDeg, dec, c);
        if (cc < -0.2) { penDown = false; continue; }
        const sx = cx - x * sc;
        const sy = cy - y * sc;
        if (sx < -W || sx > 2 * W || sy < -H || sy > 2 * H) { penDown = false; continue; }
        if (!penDown) { ctx.moveTo(sx, sy); penDown = true; }
        else ctx.lineTo(sx, sy);
      }
      ctx.stroke();
    }

    // Dec lines every 30°
    for (let dec = -60; dec < 90; dec += 30) {
      ctx.beginPath();
      let penDown = false;
      for (let ra = 0; ra <= 360; ra += 2) {
        const [x, y, cc] = stereoFwd(ra, dec, c);
        if (cc < -0.2) { penDown = false; continue; }
        const sx = cx - x * sc;
        const sy = cy - y * sc;
        if (sx < -W || sx > 2 * W || sy < -H || sy > 2 * H) { penDown = false; continue; }
        if (!penDown) { ctx.moveTo(sx, sy); penDown = true; }
        else ctx.lineTo(sx, sy);
      }
      ctx.stroke();
    }

    // RA labels
    const dpr = window.devicePixelRatio || 1;
    ctx.fillStyle = "rgba(100,100,160,0.7)";
    ctx.font = `${11 * dpr}px sans-serif`;
    for (let raH = 0; raH < 24; raH += 2) {
      const [x, y, cc] = stereoFwd(raH * 15, 0, c);
      if (cc <= 0) continue;
      const sx = cx - x * sc;
      const sy = cy - y * sc;
      if (sx > 20 * dpr && sx < W - 20 * dpr && sy > 20 * dpr && sy < H - 20 * dpr) {
        ctx.fillText(`${raH}h`, sx + 4 * dpr, sy - 4 * dpr);
      }
    }
  }

  /* ── constellations ── */
  function drawConstellations(
    ctx: CanvasRenderingContext2D, sc: number, c: ProjCenter,
    cx: number, cy: number, W: number, H: number
  ) {
    ctx.strokeStyle = "rgba(68,136,170,0.5)";
    ctx.lineWidth = 1;
    const segs = constSegs.current;
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      const [x1, y1, cc1] = stereoFwd(s.ra1, s.dec1, c);
      const [x2, y2, cc2] = stereoFwd(s.ra2, s.dec2, c);
      if (cc1 < -0.2 || cc2 < -0.2) continue;
      const sx1 = cx - x1 * sc, sy1 = cy - y1 * sc;
      const sx2 = cx - x2 * sc, sy2 = cy - y2 * sc;
      const dist = Math.hypot(sx2 - sx1, sy2 - sy1);
      if (dist > Math.max(W, H) * 1.5) continue;
      if ((sx1 < 0 && sx2 < 0) || (sx1 > W && sx2 > W) ||
          (sy1 < 0 && sy2 < 0) || (sy1 > H && sy2 > H)) continue;
      ctx.beginPath();
      ctx.moveTo(sx1, sy1);
      ctx.lineTo(sx2, sy2);
      ctx.stroke();
    }
  }

  /* ── stars ── */
  function drawStars(
    ctx: CanvasRenderingContext2D, sc: number, c: ProjCenter,
    cx: number, cy: number, W: number, H: number
  ) {
    const s = stars.current;
    for (let i = 0; i < s.length; i++) {
      const st = s[i];
      const [x, y, cc] = stereoFwd(st.ra, st.dec, c);
      if (cc < -0.2) continue;
      const sx = cx - x * sc;
      const sy = cy - y * sc;
      if (sx < -20 || sx > W + 20 || sy < -20 || sy > H + 20) continue;
      const r = starRadius(st.mag);
      const a = starAlpha(st.mag);
      ctx.fillStyle = `rgba(255,255,255,${(a / 255).toFixed(2)})`;
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /* ── overlays ── */
  function drawOverlays(
    ctx: CanvasRenderingContext2D, sc: number, c: ProjCenter,
    cx: number, cy: number, _W: number, _H: number
  ) {
    const ovs = overlays.current;
    // Draw detail overlay last (on top), like desktop
    let detailOv: Overlay | null = null;
    for (let i = 0; i < ovs.length; i++) {
      const ov = ovs[i];
      if (ov.showDetail) { detailOv = ov; continue; }
      drawSingleOverlay(ctx, ov, sc, c, cx, cy, false);
    }
    if (detailOv) {
      drawSingleOverlay(ctx, detailOv, sc, c, cx, cy, true);
    }
  }

  function drawSingleOverlay(
    ctx: CanvasRenderingContext2D, ov: Overlay,
    sc: number, c: ProjCenter, cx: number, cy: number,
    isDetail: boolean
  ) {
    // Pick the active image: detail if toggled and loaded, else preview
    const activeImg = (ov.showDetail && ov.detailImg?.complete && ov.detailImg.naturalWidth > 0)
      ? ov.detailImg : ov.img;
    if (!activeImg || !activeImg.complete || activeImg.naturalWidth === 0) return;
    const corners = ov.corners;
    if (!corners || corners.length !== 4) return;

    const screenPts: [number, number][] = [];
    let ok = true;
    for (let j = 0; j < 4; j++) {
      const [x, y, cc] = stereoFwd(corners[j][0], corners[j][1], c);
      if (cc < -0.3) { ok = false; break; }
      screenPts.push([cx - x * sc, cy - y * sc]);
    }
    if (!ok || screenPts.length !== 4) return;

    const iw = activeImg.naturalWidth;
    const ih = activeImg.naturalHeight;

    ctx.save();
    ctx.globalAlpha = isDetail ? 1.0 : 0.85;
    drawTexturedQuad(ctx, activeImg, iw, ih, screenPts);
    ctx.restore();
  }

  /* ── textured quad via 2 triangles ── */
  function drawTexturedQuad(
    ctx: CanvasRenderingContext2D,
    img: HTMLImageElement,
    iw: number, ih: number,
    pts: [number, number][]
  ) {
    // Triangle 1: TL(0), TR(1), BL(3)  — image coords (0,0), (iw,0), (0,ih)
    drawTexturedTriangle(ctx, img,
      0, 0, iw, 0, 0, ih,
      pts[0][0], pts[0][1], pts[1][0], pts[1][1], pts[3][0], pts[3][1]
    );
    // Triangle 2: TR(1), BR(2), BL(3)  — image coords (iw,0), (iw,ih), (0,ih)
    drawTexturedTriangle(ctx, img,
      iw, 0, iw, ih, 0, ih,
      pts[1][0], pts[1][1], pts[2][0], pts[2][1], pts[3][0], pts[3][1]
    );
  }

  function drawTexturedTriangle(
    ctx: CanvasRenderingContext2D, img: HTMLImageElement,
    // source triangle (image coords)
    sx0: number, sy0: number, sx1: number, sy1: number, sx2: number, sy2: number,
    // dest triangle (screen coords)
    dx0: number, dy0: number, dx1: number, dy1: number, dx2: number, dy2: number
  ) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(dx0, dy0);
    ctx.lineTo(dx1, dy1);
    ctx.lineTo(dx2, dy2);
    ctx.closePath();
    ctx.clip();

    // Solve affine transform: source → dest
    const denom = sx0 * (sy1 - sy2) + sx1 * (sy2 - sy0) + sx2 * (sy0 - sy1);
    if (Math.abs(denom) < 1e-10) { ctx.restore(); return; }
    const inv = 1 / denom;

    const a = (dx0 * (sy1 - sy2) + dx1 * (sy2 - sy0) + dx2 * (sy0 - sy1)) * inv;
    const b = (dx0 * (sx2 - sx1) + dx1 * (sx0 - sx2) + dx2 * (sx1 - sx0)) * inv;
    const e = (dx0 * (sx1 * sy2 - sx2 * sy1) + dx1 * (sx2 * sy0 - sx0 * sy2) + dx2 * (sx0 * sy1 - sx1 * sy0)) * inv;
    const cc = (dy0 * (sy1 - sy2) + dy1 * (sy2 - sy0) + dy2 * (sy0 - sy1)) * inv;
    const d = (dy0 * (sx2 - sx1) + dy1 * (sx0 - sx2) + dy2 * (sx1 - sx0)) * inv;
    const f = (dy0 * (sx1 * sy2 - sx2 * sy1) + dy1 * (sx2 * sy0 - sx0 * sy2) + dy2 * (sx0 * sy1 - sx1 * sy0)) * inv;

    ctx.setTransform(a, cc, b, d, e, f);
    ctx.drawImage(img, 0, 0);
    ctx.restore();
  }

  /* ── hit test for overlays ── */
  function hitTestOverlay(px: number, py: number, sc: number, c: ProjCenter, cx: number, cy: number): Overlay | null {
    const ovs = overlays.current;
    // Reverse order: top-drawn (last = smallest) checked first
    for (let i = ovs.length - 1; i >= 0; i--) {
      const ov = ovs[i];
      const corners = ov.corners;
      if (!corners || corners.length !== 4) continue;
      const screenPts: [number, number][] = [];
      let ok = true;
      for (let j = 0; j < 4; j++) {
        const [x, y, cc] = stereoFwd(corners[j][0], corners[j][1], c);
        if (cc < -0.3) { ok = false; break; }
        screenPts.push([cx - x * sc, cy - y * sc]);
      }
      if (!ok) continue;
      if (pointInPolygon(px, py, screenPts)) return ov;
    }
    return null;
  }

  function pointInPolygon(px: number, py: number, pts: [number, number][]): boolean {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i][0], yi = pts[i][1];
      const xj = pts[j][0], yj = pts[j][1];
      if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
    return inside;
  }

  /* ── resize ── */
  const handleResize = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    needsDraw.current = true;
  }, []);

  /* ── wheel handler (native, non-passive) ── */
  const wheelHandler = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 0.8 : 1.25;
    fov.current = Math.max(MIN_FOV, Math.min(MAX_FOV, fov.current * factor));
    needsDraw.current = true;
  }, []);

  /* ── animation loop ── */
  useEffect(() => {
    handleResize();
    window.addEventListener("resize", handleResize);

    const canvas = canvasRef.current;
    canvas?.addEventListener("wheel", wheelHandler, { passive: false });

    const loop = () => {
      if (needsDraw.current) {
        draw();
        needsDraw.current = false;
      }
      animId.current = requestAnimationFrame(loop);
    };
    animId.current = requestAnimationFrame(loop);

    return () => {
      window.removeEventListener("resize", handleResize);
      canvas?.removeEventListener("wheel", wheelHandler);
      cancelAnimationFrame(animId.current);
    };
  }, [draw, handleResize, wheelHandler]);

  /* ── mouse / touch handlers ── */
  const getCanvasPos = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    return { x: (clientX - rect.left) * dpr, y: (clientY - rect.top) * dpr };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const pos = getCanvasPos(e.clientX, e.clientY);
    pressPos.current = pos;
    dragLast.current = pos;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const pos = getCanvasPos(e.clientX, e.clientY);

    if (dragLast.current && e.buttons > 0) {
      const dx = pos.x - dragLast.current.x;
      const dy = pos.y - dragLast.current.y;
      const fovPerPx = fov.current / canvas.width;
      const cosDec = Math.cos((centerDec.current * Math.PI) / 180);
      centerRA.current = ((centerRA.current + dx * fovPerPx / Math.max(cosDec, 0.05)) % 360 + 360) % 360;
      centerDec.current = Math.max(-90, Math.min(90, centerDec.current + dy * fovPerPx));
      dragLast.current = pos;
      needsDraw.current = true;
    }

    // Update coordinate display
    const W = canvas.width;
    const H = canvas.height;
    const sc = computeScale(W, fov.current);
    const c = makeCenter(centerRA.current, centerDec.current);
    const projX = (W / 2 - pos.x) / sc;
    const projY = (H / 2 - pos.y) / sc;
    const [raDeg, decDeg] = stereoInv(projX, projY, c);
    const raH = raDeg / 15;
    const h = Math.floor(raH);
    const m = Math.floor((raH - h) * 60);
    const s = ((raH - h - m / 60) * 3600).toFixed(1);
    const sign = decDeg >= 0 ? "+" : "-";
    const dAbs = Math.abs(decDeg);
    const dd = Math.floor(dAbs);
    const dm = Math.floor((dAbs - dd) * 60);
    setCoordText(`RA: ${String(h).padStart(2, "0")}h ${String(m).padStart(2, "0")}m ${s}s   Dec: ${sign}${String(dd).padStart(2, "0")}° ${String(dm).padStart(2, "0")}'`);

    // Hover detection
    const hit = hitTestOverlay(pos.x, pos.y, sc, c, W / 2, H / 2);
    setHoverOverlay(hit);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const pos = getCanvasPos(e.clientX, e.clientY);
    if (pressPos.current) {
      const dist = Math.abs(pos.x - pressPos.current.x) + Math.abs(pos.y - pressPos.current.y);
      if (dist < 5) {
        // Click — toggle detail like desktop
        const canvas = canvasRef.current;
        if (canvas) {
          const W = canvas.width;
          const H = canvas.height;
          const sc = computeScale(W, fov.current);
          const c = makeCenter(centerRA.current, centerDec.current);
          const hit = hitTestOverlay(pos.x, pos.y, sc, c, W / 2, H / 2);
          if (hit) {
            if (hit.showDetail) {
              // Already showing detail → switch back to preview
              hit.showDetail = false;
              setSelectedOverlay(null);
              setDetailLoading(null);
            } else {
              // Clear any other detail first
              for (const ov of overlays.current) ov.showDetail = false;
              hit.showDetail = true;
              setSelectedOverlay(hit);
              // Check if detail already loaded
              if (hit.detailImg?.complete && hit.detailImg.naturalWidth > 0) {
                setDetailLoading(null);
              } else {
                setDetailLoading(hit.name);
                if (!hit.detailImg) {
                  const img = new Image();
                  img.src = `/skymap/details/${encodeURIComponent(hit.name)}.webp`;
                  img.onload = () => {
                    setDetailLoading(null);
                    needsDraw.current = true;
                  };
                  hit.detailImg = img;
                } else {
                  // Already started loading, attach handler
                  hit.detailImg.onload = () => {
                    setDetailLoading(null);
                    needsDraw.current = true;
                  };
                }
              }
            }
          } else {
            // Click empty space → clear detail
            for (const ov of overlays.current) ov.showDetail = false;
            setSelectedOverlay(null);
            setDetailLoading(null);
          }
          needsDraw.current = true;
        }
      }
    }
    pressPos.current = null;
    dragLast.current = null;
  };

  /* ── touch pinch zoom ── */
  const lastPinchDist = useRef(0);
  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      lastPinchDist.current = Math.hypot(dx, dy);
    }
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      if (lastPinchDist.current > 0) {
        const ratio = lastPinchDist.current / dist;
        fov.current = Math.max(MIN_FOV, Math.min(MAX_FOV, fov.current * ratio));
        needsDraw.current = true;
      }
      lastPinchDist.current = dist;
    }
  };

  return (
    <div className="flex flex-col h-full w-full">
      {/* top bar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#111118] border-b border-white/5 text-xs text-white/50 shrink-0">
        <span className="font-mono">{coordText}</span>
        <span>滚轮缩放 · 拖动漫游 · 单击图片切换高低分辨率</span>
      </div>

      <div className="relative flex-1 min-h-0" ref={containerRef}>
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full cursor-crosshair"
          style={{ touchAction: "none" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
        />

        {/* Hover filename label — top-left, like desktop */}
        {hoverOverlay && (
          <div className="absolute top-2 left-2 rounded bg-black/75 px-2.5 py-1 text-sm text-blue-100 pointer-events-none">
            {parseFilename(hoverOverlay.name).target}
          </div>
        )}

        {/* Detail loading indicator */}
        {detailLoading && (
          <div className="absolute top-2 right-2 rounded bg-black/75 px-3 py-1.5 text-xs text-yellow-200 pointer-events-none animate-pulse">
            加载高清图: {detailLoading}...
          </div>
        )}

        {/* Selected overlay info panel — bottom-left */}
        {selectedOverlay && (() => {
          const info = parseFilename(selectedOverlay.name);
          return (
            <div className="absolute bottom-3 left-3 max-w-xs rounded-lg bg-black/80 backdrop-blur-sm border border-white/10 p-3 text-xs text-white/80 pointer-events-none">
              <div className="font-semibold text-sm text-white mb-1">
                {info.target}
                <span className="ml-2 text-xs font-normal text-blue-300">
                  {selectedOverlay.showDetail ? "5\"/px 高清" : "20\"/px 预览"}
                </span>
              </div>
              {info.telescope && <div>望远镜: {info.telescope}</div>}
              {info.exposure && <div>单帧曝光: {info.exposure}</div>}
              {info.author && <div>作者: {info.author}</div>}
              <div>RA: {selectedOverlay.ra.toFixed(4)}°  Dec: {selectedOverlay.dec.toFixed(4)}°</div>
              <div>视场: {selectedOverlay.field_w_deg.toFixed(2)}° × {selectedOverlay.field_h_deg.toFixed(2)}°</div>
              <div>像素比例: {selectedOverlay.pixscale.toFixed(2)}&quot;/px</div>
              <div>方位角: {selectedOverlay.orientation.toFixed(1)}°</div>
              {selectedOverlay.objects.length > 0 && (
                <div className="mt-1">天体: {selectedOverlay.objects.join(", ")}</div>
              )}
            </div>
          );
        })()}
      </div>
    </div>
  );
}
