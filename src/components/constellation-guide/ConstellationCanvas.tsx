"use client";

import { useRef, useEffect, useCallback, useState } from "react";
import { stereoFwd, stereoInv, makeCenter, computeScale } from "../sky-map/projection";
import { CONSTELLATION_LINES } from "../sky-map/constellations";

/* ── types ── */
interface Star { ra: number; dec: number; mag: number; ci: number; hip?: number; }
interface ConSeg { ra1: number; dec1: number; ra2: number; dec2: number; }
interface IntuitiveLine { ra1: number; dec1: number; ra2: number; dec2: number; b: number; }

/* ── constants ── */
const MAG_LIMIT = 6.0;
const MIN_FOV = 0.5;
const MAX_FOV = 180;
const DEG2RAD = Math.PI / 180;

/* ── BV→RGB ── */
function bvToRgb(bv: number): [number, number, number] {
  let r = 1, g = 1, b = 1;
  if (bv < 0) { r = 0.61 + 0.39 * ((bv + 0.4) / 0.4); g = 0.70 + 0.30 * ((bv + 0.4) / 0.4); }
  else if (bv < 0.15) { r = 0.83 + 0.17 * (1 - bv / 0.15); g = 0.87 + 0.13 * (1 - bv / 0.15); }
  else if (bv < 0.40) { const t = (bv - 0.15) / 0.25; g = 1 - 0.08 * t; b = 1 - 0.15 * t; }
  else if (bv < 0.65) { const t = (bv - 0.40) / 0.25; g = 0.92 - 0.14 * t; b = 0.85 - 0.25 * t; }
  else if (bv < 1.0) { const t = (bv - 0.65) / 0.35; g = 0.78 - 0.18 * t; b = 0.60 - 0.30 * t; }
  else if (bv < 1.5) { const t = (bv - 1.0) / 0.5; r = 1 - 0.10 * t; g = 0.60 - 0.20 * t; b = 0.30 - 0.15 * t; }
  else { const t = (bv - 1.5) / 0.5; r = 0.90 - 0.20 * t; g = 0.40 - 0.15 * t; b = 0.15 - 0.10 * t; }
  return [Math.round(Math.max(0, Math.min(255, r * 255))),
          Math.round(Math.max(0, Math.min(255, g * 255))),
          Math.round(Math.max(0, Math.min(255, b * 255)))];
}

/* ── circular mean for RA ── */
function circularMeanRA(ras: number[]): number {
  let sx = 0, sy = 0;
  for (const r of ras) { sx += Math.cos(r * DEG2RAD); sy += Math.sin(r * DEG2RAD); }
  return ((Math.atan2(sy, sx) / DEG2RAD) % 360 + 360) % 360;
}

/* ── 88 constellation Chinese names ── */
const CONST_NAMES: Record<string, string> = {
  "And":"仙女座","Ant":"唧筒座","Aps":"天燕座","Aqr":"宝瓶座","Aql":"天鹰座",
  "Ara":"天坛座","Ari":"白羊座","Aur":"御夫座","Boo":"牧夫座","Cae":"雕具座",
  "Cam":"鹿豹座","Cnc":"巨蟹座","CVn":"猎犬座","CMa":"大犬座","CMi":"小犬座",
  "Cap":"摩羯座","Car":"船底座","Cas":"仙后座","Cen":"半人马座","Cep":"仙王座",
  "Cet":"鲸鱼座","Cha":"蝘蜓座","Cir":"圆规座","Col":"天鸽座","Com":"后发座",
  "CrA":"南冕座","CrB":"北冕座","Crv":"乌鸦座","Crt":"巨爵座","Cru":"南十字座",
  "Cyg":"天鹅座","Del":"海豚座","Dor":"剑鱼座","Dra":"天龙座","Equ":"小马座",
  "Eri":"波江座","For":"天炉座","Gem":"双子座","Gru":"天鹤座","Her":"武仙座",
  "Hor":"时钟座","Hya":"长蛇座","Hyi":"水蛇座","Ind":"印第安座","Lac":"蝎虎座",
  "Leo":"狮子座","LMi":"小狮座","Lep":"天兔座","Lib":"天秤座","Lup":"豺狼座",
  "Lyn":"天猫座","Lyr":"天琴座","Men":"山案座","Mic":"显微镜座","Mon":"麒麟座",
  "Mus":"苍蝇座","Nor":"矩尺座","Oct":"南极座","Oph":"蛇夫座","Ori":"猎户座",
  "Pav":"孔雀座","Peg":"飞马座","Per":"英仙座","Phe":"凤凰座","Pic":"绘架座",
  "Psc":"双鱼座","PsA":"南鱼座","Pup":"船尾座","Pyx":"罗盘座","Ret":"网罟座",
  "Sge":"天箭座","Sgr":"人马座","Sco":"天蝎座","Scl":"玉夫座","Sct":"盾牌座",
  "Ser":"巨蛇座","Sex":"六分仪座","Tau":"金牛座","Tel":"望远镜座","TrA":"南三角座",
  "Tri":"三角座","Tuc":"杜鹃座","UMa":"大熊座","UMi":"小熊座","Vel":"船帆座",
  "Vir":"室女座","Vol":"飞鱼座","Vul":"狐狸座",
};

export default function ConstellationCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  /* ── view state (refs for draw loop, state for UI) ── */
  const centerRA = useRef(0);
  const centerDec = useRef(0);
  const fov = useRef(120);
  const dragging = useRef(false);
  const lastPos = useRef<{ x: number; y: number } | null>(null);
  const rafId = useRef(0);

  /* ── data refs ── */
  const starsRef = useRef<Star[]>([]);
  const hipMapRef = useRef<Map<number, { ra: number; dec: number }>>(new Map());
  const constSegsRef = useRef<ConSeg[]>([]);
  const constLabelsRef = useRef<{ ra: number; dec: number; name: string }[]>([]);
  const chineseSegsRef = useRef<ConSeg[]>([]);
  const chineseLabelsRef = useRef<{ ra: number; dec: number; name: string }[]>([]);
  const intuitiveRef = useRef<IntuitiveLine[]>([]);

  /* ── layer toggles ── */
  const [showConst, setShowConst] = useState(true);
  const [showConstNames, setShowConstNames] = useState(true);
  const [showChinese, setShowChinese] = useState(false);
  const [showChineseNames, setShowChineseNames] = useState(true);
  const [showIntuitive, setShowIntuitive] = useState(false);
  const [bLow, setBLow] = useState(0.3);
  const [bHigh, setBHigh] = useState(1.5);
  const [showEqGrid, setShowEqGrid] = useState(true);

  // Keep refs in sync
  const showConstRef = useRef(true);
  const showConstNamesRef = useRef(true);
  const showChineseRef = useRef(false);
  const showChineseNamesRef = useRef(true);
  const showIntuitiveRef = useRef(false);
  const bLowRef = useRef(0.3);
  const bHighRef = useRef(1.5);
  const showEqGridRef = useRef(true);

  useEffect(() => { showConstRef.current = showConst; }, [showConst]);
  useEffect(() => { showConstNamesRef.current = showConstNames; }, [showConstNames]);
  useEffect(() => { showChineseRef.current = showChinese; }, [showChinese]);
  useEffect(() => { showChineseNamesRef.current = showChineseNames; }, [showChineseNames]);
  useEffect(() => { showIntuitiveRef.current = showIntuitive; }, [showIntuitive]);
  useEffect(() => { bLowRef.current = bLow; }, [bLow]);
  useEffect(() => { bHighRef.current = bHigh; }, [bHigh]);
  useEffect(() => { showEqGridRef.current = showEqGrid; }, [showEqGrid]);

  /* ── load data ── */
  useEffect(() => {
    const loadAll = async () => {
      // Stars (stars.json: [ra_deg, dec, mag, ci, hip?])
      const starsResp = await fetch("/skymap/stars.json");
      const starsArr: number[][] = await starsResp.json();
      const stars: Star[] = [];
      for (const s of starsArr) {
        if (s[2] <= MAG_LIMIT) {
          stars.push({ ra: s[0], dec: s[1], mag: s[2], ci: s[3] ?? 0.62 });
        }
      }
      starsRef.current = stars;

      // HIP map (hip_map.json: {"hip_str": [ra_deg, dec]})
      const hipResp = await fetch("/skymap/hip_map.json");
      const hipObj: Record<string, [number, number]> = await hipResp.json();
      const hm = new Map<number, { ra: number; dec: number }>();
      for (const [hipStr, [ra, dec]] of Object.entries(hipObj)) {
        hm.set(parseInt(hipStr), { ra, dec });
      }
      hipMapRef.current = hm;

      // Build constellation segments + labels
      const segs: ConSeg[] = [];
      const labels: { ra: number; dec: number; name: string }[] = [];
      for (const [abbr, hips] of CONSTELLATION_LINES) {
        const raPts: number[] = [];
        const decPts: number[] = [];
        for (let k = 0; k < hips.length - 1; k += 2) {
          const s1 = hm.get(hips[k]);
          const s2 = hm.get(hips[k + 1]);
          if (!s1 || !s2) continue;
          segs.push({ ra1: s1.ra, dec1: s1.dec, ra2: s2.ra, dec2: s2.dec });
          raPts.push(s1.ra, s2.ra);
          decPts.push(s1.dec, s2.dec);
        }
        if (raPts.length > 0 && CONST_NAMES[abbr]) {
          labels.push({
            ra: circularMeanRA(raPts),
            dec: decPts.reduce((a, b) => a + b, 0) / decPts.length,
            name: CONST_NAMES[abbr],
          });
        }
      }
      constSegsRef.current = segs;
      constLabelsRef.current = labels;

      // Chinese asterisms
      const chResp = await fetch("/constellation-guide/chinese_asterisms.json");
      const chData: { lines: [number, number][]; names: Record<string, string> } = await chResp.json();
      const chSegs: ConSeg[] = [];
      for (const [h1, h2] of chData.lines) {
        const s1 = hm.get(h1);
        const s2 = hm.get(h2);
        if (s1 && s2) chSegs.push({ ra1: s1.ra, dec1: s1.dec, ra2: s2.ra, dec2: s2.dec });
      }
      chineseSegsRef.current = chSegs;
      const chLabels: { ra: number; dec: number; name: string }[] = [];
      for (const [hipStr, name] of Object.entries(chData.names)) {
        const s = hm.get(parseInt(hipStr));
        if (s) chLabels.push({ ra: s.ra, dec: s.dec, name });
      }
      chineseLabelsRef.current = chLabels;

      // Intuitive lines
      const intResp = await fetch("/constellation-guide/intuitive_lines.json");
      const intArr: number[][] = await intResp.json();
      intuitiveRef.current = intArr.map(([ra1, dec1, ra2, dec2, b]) => ({ ra1, dec1, ra2, dec2, b }));

      requestDraw();
    };
    loadAll();
  }, []);

  /* ── drawing ── */
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Background
    ctx.fillStyle = "#08080f";
    ctx.fillRect(0, 0, w, h);

    const sc = computeScale(w, fov.current);
    const proj = makeCenter(centerRA.current, centerDec.current);
    const cx = w / 2;
    const cy = h / 2;
    const maxDist = Math.max(w, h) * 1.5;

    // Helper: project and get screen coords
    const toScreen = (raDeg: number, decDeg: number): [number, number, number] => {
      const [x, y, cc] = stereoFwd(raDeg, decDeg, proj);
      return [cx - x * sc, cy - y * sc, cc];
    };

    // ── equatorial grid ──
    if (showEqGridRef.current) {
      ctx.strokeStyle = "rgba(40,40,80,0.35)";
      ctx.lineWidth = 0.5;
      // RA lines
      for (let ra = 0; ra < 360; ra += 15) {
        ctx.beginPath();
        let started = false;
        for (let dec = -90; dec <= 90; dec += 2) {
          const [sx, sy, cc] = toScreen(ra, dec);
          if (cc < -0.2) { started = false; continue; }
          if (!started) { ctx.moveTo(sx, sy); started = true; }
          else ctx.lineTo(sx, sy);
        }
        ctx.stroke();
      }
      // Dec lines
      for (let dec = -75; dec <= 75; dec += 15) {
        ctx.beginPath();
        let started = false;
        for (let ra = 0; ra <= 360; ra += 2) {
          const [sx, sy, cc] = toScreen(ra, dec);
          if (cc < -0.2) { started = false; continue; }
          if (!started) { ctx.moveTo(sx, sy); started = true; }
          else ctx.lineTo(sx, sy);
        }
        ctx.stroke();
      }
    }

    // ── draw line segments helper ──
    const drawSegs = (segs: ConSeg[], color: string, lineWidth: number) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      for (const s of segs) {
        const [sx1, sy1, cc1] = toScreen(s.ra1, s.dec1);
        const [sx2, sy2, cc2] = toScreen(s.ra2, s.dec2);
        if (cc1 < -0.2 || cc2 < -0.2) continue;
        const dx = sx2 - sx1, dy = sy2 - sy1;
        if (Math.sqrt(dx * dx + dy * dy) > maxDist) continue;
        if ((sx1 < -20 && sx2 < -20) || (sx1 > w + 20 && sx2 > w + 20)) continue;
        if ((sy1 < -20 && sy2 < -20) || (sy1 > h + 20 && sy2 > h + 20)) continue;
        ctx.moveTo(sx1, sy1);
        ctx.lineTo(sx2, sy2);
      }
      ctx.stroke();
    };

    // ── draw labels helper ──
    const drawLabels = (labels: { ra: number; dec: number; name: string }[], color: string, fontSize: number, offsetX: number, offsetY: number) => {
      ctx.fillStyle = color;
      ctx.font = `${fontSize}px "Microsoft YaHei", sans-serif`;
      for (const lb of labels) {
        const [sx, sy, cc] = toScreen(lb.ra, lb.dec);
        if (cc < -0.1 || sx < -20 || sx > w + 20 || sy < -20 || sy > h + 20) continue;
        ctx.fillText(lb.name, sx + offsetX, sy + offsetY);
      }
    };

    // ── constellation lines ──
    if (showConstRef.current) {
      drawSegs(constSegsRef.current, "rgba(68,136,170,0.5)", 1);
      if (showConstNamesRef.current) {
        drawLabels(constLabelsRef.current, "rgba(90,160,200,0.7)", 12, -10, -8);
      }
    }

    // ── chinese asterisms ──
    if (showChineseRef.current) {
      drawSegs(chineseSegsRef.current, "rgba(200,80,80,0.55)", 1);
      if (showChineseNamesRef.current) {
        drawLabels(chineseLabelsRef.current, "rgba(200,100,100,0.65)", 11, 5, -5);
      }
    }

    // ── intuitive lines ──
    if (showIntuitiveRef.current) {
      const lo = bLowRef.current;
      const hi = bHighRef.current;
      const filtered = intuitiveRef.current.filter(l => l.b >= lo && l.b <= hi);
      const fSegs: ConSeg[] = filtered.map(l => ({ ra1: l.ra1, dec1: l.dec1, ra2: l.ra2, dec2: l.dec2 }));
      drawSegs(fSegs, "rgba(255,180,50,0.6)", 1.2);
    }

    // ── stars ──
    const stars = starsRef.current;
    for (const s of stars) {
      const [sx, sy, cc] = toScreen(s.ra, s.dec);
      if (cc < -0.2 || sx < -20 || sx > w + 20 || sy < -20 || sy > h + 20) continue;
      const t = Math.max(0, (MAG_LIMIT - s.mag)) / (MAG_LIMIT + 1);
      const rad = 1 + 5 * t * t;
      const alpha = Math.min(255, Math.max(80, Math.round(80 + 175 * (1 - s.mag / MAG_LIMIT))));
      const [cr, cg, cb] = bvToRgb(s.ci);
      ctx.fillStyle = `rgba(${cr},${cg},${cb},${alpha / 255})`;
      ctx.beginPath();
      ctx.arc(sx, sy, rad, 0, Math.PI * 2);
      ctx.fill();
    }

    // ── coordinate text ──
    const [invRa, invDec] = stereoInv(0, 0, proj);
    const raH = invRa / 15;
    const hh = Math.floor(raH);
    const mm = Math.floor((raH - hh) * 60);
    const ss = ((raH - hh - mm / 60) * 3600).toFixed(1);
    const sign = invDec >= 0 ? "+" : "-";
    const ad = Math.abs(invDec);
    const dd = Math.floor(ad);
    const dm = Math.floor((ad - dd) * 60);
    const ds = ((ad - dd - dm / 60) * 3600).toFixed(1);
    ctx.fillStyle = "rgba(100,100,160,0.55)";
    ctx.font = "11px monospace";
    ctx.fillText(
      `RA ${String(hh).padStart(2, "0")}h${String(mm).padStart(2, "0")}m${ss}s  Dec ${sign}${String(dd).padStart(2, "0")}°${String(dm).padStart(2, "0")}′${ds}″  FOV ${fov.current.toFixed(1)}°`,
      8, h - 8
    );
  }, []);

  const requestDraw = useCallback(() => {
    cancelAnimationFrame(rafId.current);
    rafId.current = requestAnimationFrame(draw);
  }, [draw]);

  // Redraw on toggle changes
  useEffect(() => { requestDraw(); }, [showConst, showConstNames, showChinese, showChineseNames, showIntuitive, bLow, bHigh, showEqGrid, requestDraw]);

  /* ── resize ── */
  useEffect(() => {
    const obs = new ResizeObserver(() => requestDraw());
    if (wrapRef.current) obs.observe(wrapRef.current);
    return () => obs.disconnect();
  }, [requestDraw]);

  /* ── wheel zoom (native listener to allow preventDefault) ── */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 1.1 : 1 / 1.1;
      fov.current = Math.max(MIN_FOV, Math.min(MAX_FOV, fov.current * factor));
      requestDraw();
    };
    canvas.addEventListener("wheel", handler, { passive: false });
    return () => canvas.removeEventListener("wheel", handler);
  }, [requestDraw]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    dragging.current = true;
    lastPos.current = { x: e.clientX, y: e.clientY };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current || !lastPos.current || !canvasRef.current) return;
    const dx = e.clientX - lastPos.current.x;
    const dy = e.clientY - lastPos.current.y;
    lastPos.current = { x: e.clientX, y: e.clientY };
    const fovPerPx = fov.current / canvasRef.current.clientWidth;
    const cosDec = Math.cos(centerDec.current * DEG2RAD);
    centerRA.current = ((centerRA.current + dx * fovPerPx / Math.max(cosDec, 0.05)) % 360 + 360) % 360;
    centerDec.current = Math.max(-90, Math.min(90, centerDec.current + dy * fovPerPx));
    requestDraw();
  }, [requestDraw]);

  const onPointerUp = useCallback(() => {
    dragging.current = false;
    lastPos.current = null;
  }, []);

  /* ── b slider helpers ── */
  const sliderToB = (val: number) => {
    const logMin = Math.log10(0.01);
    const logMax = Math.log10(10);
    return Math.pow(10, logMin + (logMax - logMin) * val / 200);
  };
  const bToSlider = (b: number) => {
    const logMin = Math.log10(0.01);
    const logMax = Math.log10(10);
    return Math.round((Math.log10(Math.max(0.01, Math.min(10, b))) - logMin) / (logMax - logMin) * 200);
  };

  return (
    <div className="flex flex-1 min-h-0">
      {/* Sidebar */}
      <div className="w-48 shrink-0 bg-[#181825] border-r border-border/30 p-3 flex flex-col gap-2 overflow-y-auto text-xs">
        <div className="text-blue-400 font-bold text-sm mb-1">显示控制</div>

        {/* Eq grid */}
        <label className="flex items-center gap-2 cursor-pointer text-white/70 hover:text-white/90">
          <input type="checkbox" checked={showEqGrid} onChange={(e) => setShowEqGrid(e.target.checked)}
            className="accent-blue-400 w-3.5 h-3.5" />
          赤道坐标网格
        </label>

        {/* 88 Constellations */}
        <button
          className={`text-left px-2 py-1.5 rounded text-xs font-medium transition-colors ${showConst ? "bg-blue-500/80 text-white" : "bg-white/5 text-white/60 hover:bg-white/10"}`}
          onClick={() => setShowConst(!showConst)}
        >
          {showConst ? "现代88星座连线 ✓" : "现代88星座连线"}
        </button>
        {showConst && (
          <label className="flex items-center gap-2 cursor-pointer text-white/50 hover:text-white/70 pl-2">
            <input type="checkbox" checked={showConstNames} onChange={(e) => setShowConstNames(e.target.checked)}
              className="accent-green-400 w-3 h-3" />
            └ 显示星座名称
          </label>
        )}

        {/* Chinese asterisms */}
        <button
          className={`text-left px-2 py-1.5 rounded text-xs font-medium transition-colors ${showChinese ? "bg-red-500/70 text-white" : "bg-white/5 text-white/60 hover:bg-white/10"}`}
          onClick={() => setShowChinese(!showChinese)}
        >
          {showChinese ? "中国古代星官 ✓" : "中国古代星官"}
        </button>
        {showChinese && (
          <label className="flex items-center gap-2 cursor-pointer text-white/50 hover:text-white/70 pl-2">
            <input type="checkbox" checked={showChineseNames} onChange={(e) => setShowChineseNames(e.target.checked)}
              className="accent-green-400 w-3 h-3" />
            └ 显示星官名称
          </label>
        )}

        {/* Intuitive lines */}
        <button
          className={`text-left px-2 py-1.5 rounded text-xs font-medium transition-colors ${showIntuitive ? "bg-amber-500/70 text-white" : "bg-white/5 text-white/60 hover:bg-white/10"}`}
          onClick={() => setShowIntuitive(!showIntuitive)}
        >
          {showIntuitive ? "直观亮星连线 ✓" : "直观亮星连线"}
        </button>
        {showIntuitive && (
          <div className="pl-2 space-y-1">
            <div className="text-white/40 text-[10px]">b = m₁·m₂ / r²</div>
            <div className="flex items-center gap-1">
              <span className="text-white/40 w-6">下限</span>
              <input type="range" min={0} max={200} value={bToSlider(bLow)}
                onChange={(e) => setBLow(sliderToB(parseInt(e.target.value)))}
                className="flex-1 h-1 accent-blue-400" />
              <span className="text-white/50 w-8 text-right">{bLow.toFixed(2)}</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-white/40 w-6">上限</span>
              <input type="range" min={0} max={200} value={bToSlider(bHigh)}
                onChange={(e) => setBHigh(sliderToB(parseInt(e.target.value)))}
                className="flex-1 h-1 accent-blue-400" />
              <span className="text-white/50 w-8 text-right">{bHigh.toFixed(2)}</span>
            </div>
            <div className="text-white/30 text-[10px]">
              连线数: {intuitiveRef.current.filter(l => l.b >= bLow && l.b <= bHigh).length}
            </div>
          </div>
        )}

        <div className="flex-1" />
        <div className="text-white/25 text-[10px] leading-tight">
          滚轮缩放 · 拖动漫游<br />
          {starsRef.current.length} 颗恒星
        </div>
      </div>

      {/* Canvas */}
      <div ref={wrapRef} className="flex-1 min-w-0 min-h-0 relative">
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full cursor-crosshair"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
        />
      </div>
    </div>
  );
}
