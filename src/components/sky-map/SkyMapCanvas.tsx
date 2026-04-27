"use client";

import { useRef, useEffect, useCallback, useState } from "react";
import { stereoFwd, stereoInv, makeCenter, computeScale, eqToGal, galToEq } from "./projection";
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
    return { target, telescope, exposure: exposure === "?" ? "?" : exposure + "h", author };
  }
  return { target: name, telescope: "", exposure: "", author: "" };
}

/* ── catalog row layouts (compact JSON arrays) ── */
// PN:  [ra, dec, rad_deg, has_size, is_candidate, label]
// SNR: [ra, dec, rad_deg, label]
// DSO: [ra, dec, rad_deg, has_size, cat_code, label]  cat: 0=M 1=NGC 2=IC 3=Sh2
type PNRow  = [number, number, number, number, number, string];
type SNRRow = [number, number, number, string];
type DSORow = [number, number, number, number, number, string];

/* ── constants ── */
const MAG_LIMIT = 6.0;
const MIN_FOV = 0.5;
const MAX_FOV = 180;
const PN_MIN_R = 3;
const SNR_MIN_R = 4;
const DSO_MIN_R = 3;

/* ── precompute star display props ── */
function starRadius(mag: number): number {
  const t = Math.max(0, (MAG_LIMIT - mag)) / (MAG_LIMIT + 1);
  return 1 + 5 * t * t;
}
function starAlpha(mag: number): number {
  return Math.min(255, Math.max(80, Math.round(80 + 175 * (1 - mag / MAG_LIMIT))));
}

/* ── toggle button ── */
function ToggleBtn({ label, on, bg, color, onClick }: {
  label: string; on: boolean; bg: string; color: string; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="px-2 py-0.5 rounded text-xs font-medium transition-all select-none"
      style={{
        background: on ? bg : "rgba(60,60,60,.7)",
        color: on ? color : "#888",
      }}
    >
      {on ? "☑" : "☐"} {label}
    </button>
  );
}

/* ── coordinate jump row (includes name search + equatorial + galactic) ── */
function CoordJumpRow({ jumpTo, searchQuery, onSearchInput, onSearchSubmit, searchResults, showDropdown, setShowDropdown }: {
  jumpTo: (ra: number, dec: number, fov?: number) => void;
  searchQuery: string;
  onSearchInput: (v: string) => void;
  onSearchSubmit: () => void;
  searchResults: { label: string; ra: number; dec: number; fov?: number }[];
  showDropdown: boolean;
  setShowDropdown: (v: boolean) => void;
}) {
  const [raH, setRaH] = useState(""); const [raM, setRaM] = useState(""); const [raS, setRaS] = useState("");
  const [decD, setDecD] = useState(""); const [decM, setDecM] = useState(""); const [decS, setDecS] = useState("");
  const [gl, setGl] = useState(""); const [gb, setGb] = useState("");

  const doRaDec = () => {
    const h = parseFloat(raH || "0"), m = parseFloat(raM || "0"), s = parseFloat(raS || "0");
    const dd = parseFloat(decD || "0"), dm = parseFloat(decM || "0"), ds = parseFloat(decS || "0");
    const ra = (h + m / 60 + s / 3600) * 15;
    const sign = dd < 0 ? -1 : 1;
    const dec = sign * (Math.abs(dd) + dm / 60 + ds / 3600);
    jumpTo(((ra % 360) + 360) % 360, Math.max(-90, Math.min(90, dec)));
  };

  const doGal = () => {
    const l = parseFloat(gl || "0"), b = parseFloat(gb || "0");
    const [ra, dec] = galToEq(((l % 360) + 360) % 360, Math.max(-90, Math.min(90, b)));
    jumpTo(ra, dec);
  };

  const inp = "w-20 px-1.5 py-0.5 rounded text-xs bg-white/5 border border-white/10 text-white/80 outline-none focus:border-indigo-400/50 text-center";
  return (
    <div className="flex items-center gap-1.5 px-3 py-0.5 bg-[#111118] border-b border-white/5 shrink-0 flex-wrap text-xs text-white/50">
      {/* ── Name search ── */}
      <div className="relative flex items-center gap-1">
        <span className="text-white/40">名称搜索</span>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onSearchSubmit(); } }}
          onFocus={() => { if (searchResults.length > 0) setShowDropdown(true); }}
          onBlur={() => { setTimeout(() => setShowDropdown(false), 200); }}
          placeholder="天体名称"
          className="w-48 px-2 py-0.5 rounded text-xs bg-white/5 border border-white/10 text-white/80 placeholder:text-white/20 outline-none focus:border-indigo-400/50"
        />
        <button onClick={onSearchSubmit} className="px-1.5 py-0.5 rounded text-xs bg-indigo-500/60 text-white/90 hover:bg-indigo-400/70 transition-colors">跳转</button>
        {showDropdown && searchResults.length > 0 && (
          <div className="absolute top-full left-0 mt-0.5 w-72 max-h-52 overflow-y-auto rounded bg-[#1a1a2e]/95 border border-white/10 shadow-lg z-50">
            {searchResults.map((r, i) => (
              <div key={i} className="px-2.5 py-1.5 text-xs text-white/80 hover:bg-indigo-500/30 cursor-pointer truncate"
                onMouseDown={(e) => { e.preventDefault(); jumpTo(r.ra, r.dec, r.fov); onSearchInput(r.label); }}>
                {r.label}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="w-px h-4 bg-white/10 mx-1.5" />

      {/* ── Equatorial coordinate search ── */}
      <span className="text-white/40">赤道坐标</span>
      <span>RA(赤经)</span>
      <input className={inp} value={raH} onChange={e=>setRaH(e.target.value)} placeholder="h" onKeyDown={e=>{if(e.key==="Enter")doRaDec();}} />
      <input className={inp} value={raM} onChange={e=>setRaM(e.target.value)} placeholder="m" onKeyDown={e=>{if(e.key==="Enter")doRaDec();}} />
      <input className={inp} value={raS} onChange={e=>setRaS(e.target.value)} placeholder="s" onKeyDown={e=>{if(e.key==="Enter")doRaDec();}} />
      <span>Dec(赤纬)</span>
      <input className={inp} value={decD} onChange={e=>setDecD(e.target.value)} placeholder="°" onKeyDown={e=>{if(e.key==="Enter")doRaDec();}} />
      <input className={inp} value={decM} onChange={e=>setDecM(e.target.value)} placeholder="′" onKeyDown={e=>{if(e.key==="Enter")doRaDec();}} />
      <input className={inp} value={decS} onChange={e=>setDecS(e.target.value)} placeholder="″" onKeyDown={e=>{if(e.key==="Enter")doRaDec();}} />
      <button onClick={doRaDec} className="px-1.5 py-0.5 rounded text-xs bg-indigo-500/60 text-white/90 hover:bg-indigo-400/70">跳转</button>

      <div className="w-px h-4 bg-white/10 mx-1.5" />

      {/* ── Galactic coordinate search ── */}
      <span className="text-white/40">银道坐标</span>
      <span>l(银经)</span>
      <input className={`${inp} w-28`} value={gl} onChange={e=>setGl(e.target.value)} placeholder="°" onKeyDown={e=>{if(e.key==="Enter")doGal();}} />
      <span>b(银纬)</span>
      <input className={`${inp} w-28`} value={gb} onChange={e=>setGb(e.target.value)} placeholder="°" onKeyDown={e=>{if(e.key==="Enter")doGal();}} />
      <button onClick={doGal} className="px-1.5 py-0.5 rounded text-xs bg-indigo-500/60 text-white/90 hover:bg-indigo-400/70">跳转</button>
    </div>
  );
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

  const pnData = useRef<PNRow[]>([]);
  const snrData = useRef<SNRRow[]>([]);
  const dsoData = useRef<DSORow[]>([]);

  const [coordText, setCoordText] = useState("RA: --  Dec: --");
  const [hoverOverlay, setHoverOverlay] = useState<Overlay | null>(null);
  const [selectedOverlay, setSelectedOverlay] = useState<Overlay | null>(null);
  const [detailLoading, setDetailLoading] = useState<string | null>(null);

  /* ── search ── */
  type SearchEntry = { norm: string; label: string; ra: number; dec: number; fov: number };
  type CatEntry = { prefix: string; num: string; label: string; ra: number; dec: number; fov: number };
  const searchNames = useRef<SearchEntry[]>([]);
  const searchCats = useRef<CatEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<{ label: string; ra: number; dec: number; fov: number; score: number }[]>([]);
  const [showSearchDropdown, setShowSearchDropdown] = useState(false);

  const [showPN, setShowPN] = useState(true);
  const [showSNR, setShowSNR] = useState(true);
  const [showMessier, setShowMessier] = useState(true);
  const [showNGC, setShowNGC] = useState(false);
  const [showIC, setShowIC] = useState(false);
  const [showSh2, setShowSh2] = useState(false);
  // Keep refs in sync for draw loop
  const showPNRef = useRef(true);
  const showSNRRef = useRef(true);
  const showMessierRef = useRef(true);
  const showNGCRef = useRef(false);
  const showICRef = useRef(false);
  const showSh2Ref = useRef(false);

  /* ── grid toggles ── */
  const [showEqGrid, setShowEqGrid] = useState(true);
  const [showGalGrid, setShowGalGrid] = useState(false);
  const showEqGridRef = useRef(true);
  const showGalGridRef = useRef(false);

  /* ── crosshair ── */
  const showCrosshairRef = useRef(false);

  /* ── camera simulator ── */
  type CamConfig = { focal: number; sw: number; sh: number; angle: number; mosX: number; mosY: number; overlap: number };
  const [showCamSim, setShowCamSim] = useState(false);
  const [camEntries, setCamEntries] = useState<CamConfig[]>([]);
  const camEntriesRef = useRef<CamConfig[]>([]);
  const showCamSimRef = useRef(false);

  /* ── load data ── */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [starsRes, hipRes, metaRes, pnRes, snrRes, dsoRes] = await Promise.all([
        fetch("/skymap/stars.json"),
        fetch("/skymap/hip_map.json"),
        fetch("/skymap/metadata.json"),
        fetch("/skymap/pn_catalog.json"),
        fetch("/skymap/snr_catalog.json"),
        fetch("/skymap/dso_catalog.json"),
      ]);
      if (cancelled) return;

      pnData.current = await pnRes.json();
      snrData.current = await snrRes.json();
      dsoData.current = await dsoRes.json();

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
      // Build search index
      buildSearchIndex(metaData, dsoData.current);
    })();
    return () => { cancelled = true; };
  }, []);

  /* ── search index ── */
  const normalize = (s: string) => s.replace(/[\s\-_()]+/g, "").toLowerCase();

  const CAT_PREFIX_RX = /^(NGC|Sh\s*2|IC|MEL|M|C|B)\s*-?\s*(\d+.*)$/i;
  const ID_RX = /(?:NGC|Sh\s*2|IC|MEL|M)\s+(\d+)/gi;
  const PAREN_RX = /\((\w+)\s+\d+\)/;

  function buildSearchIndex(metas: Overlay[], dso: DSORow[]) {
    const names: SearchEntry[] = [];
    const rawCats: Record<string, CatEntry & { quality: number }> = {};
    const xrefQ: Record<string, number> = { NGC: 40, SH2: 30, MEL: 20, IC: 10 };

    // Overlays (photos)
    for (const m of metas) {
      const parts = m.name.split("_");
      const display = parts.length >= 4
        ? `${parts.slice(0, -3).join("_")} (${parts[parts.length - 1]})`
        : m.name;
      const fovH = Math.max(m.field_w_deg, m.field_h_deg) * 1.5;
      const label = `📷 ${display}`;
      names.push({ norm: normalize(display), label, ra: m.ra, dec: m.dec, fov: fovH });
      if (parts.length === 4) {
        names.push({ norm: normalize(parts[0]), label, ra: m.ra, dec: m.dec, fov: fovH });
      }
    }

    // DSO catalog
    for (const row of dso) {
      const [ra, dec, radDeg, , , nm] = row;
      if (!nm) continue;
      const fovD = Math.max(radDeg * 6, 1.0);
      const label = `⚪ ${nm}`;
      names.push({ norm: normalize(nm), label, ra, dec, fov: fovD });

      const pm = PAREN_RX.exec(nm);
      const xc = pm ? pm[1].toUpperCase() : "";
      const quality = xrefQ[xc] ?? 0;

      const idRx = /(NGC|Sh\s*2|IC|MEL|M)\s+(\d+)/gi;
      let match;
      while ((match = idRx.exec(nm)) !== null) {
        const pfx = match[1].toUpperCase().replace(/\s/g, "");
        const num = match[2];
        const key = `${pfx}:${num}`;
        if (!rawCats[key] || quality > rawCats[key].quality) {
          rawCats[key] = { prefix: pfx, num, label, ra, dec, fov: fovD, quality };
        }
      }
    }

    searchNames.current = names;
    searchCats.current = Object.values(rawCats).map(({ quality, ...rest }) => rest);
  }

  function doSearch(query: string, limit = 8) {
    const q = query.trim();
    if (!q) return [];
    const results: { label: string; ra: number; dec: number; fov: number; score: number }[] = [];

    // Phase 1: catalog prefix + number
    const cm = CAT_PREFIX_RX.exec(q);
    if (cm) {
      let qp = cm[1].toUpperCase().replace(/\s/g, "");
      const qn = cm[2].trim();
      if (qp === "SH" || qp === "SH2") qp = "SH2";
      for (const c of searchCats.current) {
        if (c.prefix !== qp) continue;
        if (c.num === qn) results.push({ ...c, score: 10000 });
        else if (c.num.startsWith(qn)) results.push({ ...c, score: 8000 - c.num.length });
      }
    }

    // Phase 2: fuzzy name
    const nq = normalize(q);
    if (nq) {
      for (const e of searchNames.current) {
        if (!e.norm.includes(nq)) continue;
        let score: number;
        if (e.norm === nq) score = 5000;
        else if (e.norm.startsWith(nq)) score = 3000 - e.norm.length;
        else score = 1000 - e.norm.length;
        results.push({ label: e.label, ra: e.ra, dec: e.dec, fov: e.fov, score });
      }
    }

    results.sort((a, b) => b.score - a.score);
    const seen = new Set<string>();
    const out: typeof results = [];
    for (const r of results) {
      if (seen.has(r.label)) continue;
      seen.add(r.label);
      out.push(r);
      if (out.length >= limit) break;
    }
    return out;
  }

  function handleSearchInput(val: string) {
    setSearchQuery(val);
    if (!val.trim()) {
      setSearchResults([]);
      setShowSearchDropdown(false);
      return;
    }
    const res = doSearch(val);
    setSearchResults(res);
    setShowSearchDropdown(res.length > 0);
  }

  function jumpTo(ra: number, dec: number, fovVal: number) {
    centerRA.current = ra;
    centerDec.current = dec;
    fov.current = Math.min(fovVal, MAX_FOV);
    needsDraw.current = true;
    setShowSearchDropdown(false);
  }

  function handleSearchSubmit() {
    if (searchResults.length > 0) {
      const r = searchResults[0];
      jumpTo(r.ra, r.dec, r.fov);
    }
  }

  /* ── camera entry management ── */
  function addCamEntry() {
    const next = [...camEntries, { focal: 500, sw: 36, sh: 24, angle: 0, mosX: 1, mosY: 1, overlap: 20 }];
    setCamEntries(next);
    camEntriesRef.current = next;
    needsDraw.current = true;
  }
  function removeCamEntry(idx: number) {
    const next = camEntries.filter((_, i) => i !== idx);
    setCamEntries(next);
    camEntriesRef.current = next;
    needsDraw.current = true;
  }
  function updateCamEntry(idx: number, field: keyof CamConfig, value: string) {
    const next = camEntries.map((c, i) => {
      if (i !== idx) return c;
      const v = parseFloat(value) || 0;
      const updated = { ...c, [field]: v };
      if (field === "mosX" || field === "mosY") updated[field] = Math.max(1, Math.round(v));
      return updated;
    });
    setCamEntries(next);
    camEntriesRef.current = next;
    needsDraw.current = true;
  }

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

    if (showEqGridRef.current) drawGraticule(ctx, sc, c, cx, cy, W, H);
    if (showGalGridRef.current) drawGalacticGraticule(ctx, sc, c, cx, cy, W, H);
    drawConstellations(ctx, sc, c, cx, cy, W, H);
    drawStars(ctx, sc, c, cx, cy, W, H);
    drawOverlays(ctx, sc, c, cx, cy, W, H);
    drawPN(ctx, sc, c, cx, cy, W, H, fov.current);
    drawSNR(ctx, sc, c, cx, cy, W, H, fov.current);
    drawDSO(ctx, sc, c, cx, cy, W, H, fov.current);
    drawCamFov(ctx, sc, cx, cy);

    // Crosshair
    if (showCrosshairRef.current) {
      const chSize = 12 * dpr;
      const gap = 3 * dpr;
      ctx.strokeStyle = "rgba(255,80,80,0.8)";
      ctx.lineWidth = 1.2 * dpr;
      ctx.beginPath();
      ctx.moveTo(cx - chSize, cy); ctx.lineTo(cx - gap, cy);
      ctx.moveTo(cx + gap, cy); ctx.lineTo(cx + chSize, cy);
      ctx.moveTo(cx, cy - chSize); ctx.lineTo(cx, cy - gap);
      ctx.moveTo(cx, cy + gap); ctx.lineTo(cx, cy + chSize);
      ctx.stroke();
    }

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
      ctx.lineWidth = dec === 0 ? 2 : 1;
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
    ctx.lineWidth = 1;

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

  /* ── galactic graticule ── */
  function drawGalacticGraticule(
    ctx: CanvasRenderingContext2D, sc: number, c: ProjCenter,
    cx: number, cy: number, W: number, H: number
  ) {
    ctx.strokeStyle = "rgba(200,200,220,0.18)";
    // Galactic longitude lines every 30°
    for (let lDeg = 0; lDeg < 360; lDeg += 30) {
      ctx.lineWidth = 1;
      ctx.beginPath();
      let penDown = false;
      for (let bDeg = -90; bDeg <= 90; bDeg += 2) {
        const [eqRa, eqDec] = galToEq(lDeg, bDeg);
        const [x, y, cc] = stereoFwd(eqRa, eqDec, c);
        if (cc < -0.2) { penDown = false; continue; }
        const sx = cx - x * sc;
        const sy = cy - y * sc;
        if (sx < -W || sx > 2 * W || sy < -H || sy > 2 * H) { penDown = false; continue; }
        if (!penDown) { ctx.moveTo(sx, sy); penDown = true; }
        else ctx.lineTo(sx, sy);
      }
      ctx.stroke();
    }
    // Galactic latitude lines every 15°
    for (let bDeg = -75; bDeg < 90; bDeg += 15) {
      ctx.lineWidth = bDeg === 0 ? 2 : 1;
      ctx.beginPath();
      let penDown = false;
      for (let lDeg = 0; lDeg <= 360; lDeg += 2) {
        const [eqRa, eqDec] = galToEq(lDeg, bDeg);
        const [x, y, cc] = stereoFwd(eqRa, eqDec, c);
        if (cc < -0.2) { penDown = false; continue; }
        const sx = cx - x * sc;
        const sy = cy - y * sc;
        if (sx < -W || sx > 2 * W || sy < -H || sy > 2 * H) { penDown = false; continue; }
        if (!penDown) { ctx.moveTo(sx, sy); penDown = true; }
        else ctx.lineTo(sx, sy);
      }
      ctx.stroke();
    }
    ctx.lineWidth = 1;
    // l labels at b=0
    const dpr = window.devicePixelRatio || 1;
    ctx.fillStyle = "rgba(200,200,220,0.31)";
    ctx.font = `${11 * dpr}px sans-serif`;
    for (let lDeg = 0; lDeg < 360; lDeg += 30) {
      const [eqRa, eqDec] = galToEq(lDeg, 0);
      const [x, y, cc] = stereoFwd(eqRa, eqDec, c);
      if (cc <= 0) continue;
      const sx = cx - x * sc;
      const sy = cy - y * sc;
      if (sx > 20 * dpr && sx < W - 20 * dpr && sy > 20 * dpr && sy < H - 20 * dpr) {
        ctx.fillText(`l${lDeg}°`, sx + 4 * dpr, sy - 4 * dpr);
      }
    }
  }

  /* ── camera FoV simulation ── */
  function drawCamFov(
    ctx: CanvasRenderingContext2D, sc: number, cx: number, cy: number
  ) {
    if (!showCamSimRef.current) return;
    const cfgs = camEntriesRef.current;
    if (cfgs.length === 0) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.font = `${11 * dpr}px sans-serif`;

    for (const cfg of cfgs) {
      const { focal, sw, sh, angle, mosX, mosY, overlap } = cfg;
      if (focal <= 0 || sw <= 0 || sh <= 0) continue;
      const hwRad = Math.atan(sw / (2 * focal));
      const hhRad = Math.atan(sh / (2 * focal));
      const pw = 2 * Math.tan(hwRad / 2) * sc;
      const ph = 2 * Math.tan(hhRad / 2) * sc;
      const cosA = Math.cos(angle * Math.PI / 180);
      const sinA = Math.sin(angle * Math.PI / 180);
      const olap = Math.max(0, Math.min(99, overlap)) / 100;
      const stepW = pw * 2 * (1 - olap);
      const stepH = ph * 2 * (1 - olap);
      const totalHW = mosX > 1 ? pw + stepW * (mosX - 1) / 2 : pw;
      const totalHH = mosY > 1 ? ph + stepH * (mosY - 1) / 2 : ph;

      const rot = (x: number, y: number): [number, number] => [
        x * cosA - y * sinA, x * sinA + y * cosA
      ];

      // Draw each mosaic panel
      ctx.strokeStyle = "rgba(255,60,60,0.78)";
      ctx.lineWidth = 1.5 * dpr;
      ctx.setLineDash([]);
      for (let ix = 0; ix < mosX; ix++) {
        for (let iy = 0; iy < mosY; iy++) {
          const pcx = mosX > 1 ? stepW * (ix - (mosX - 1) / 2) : 0;
          const pcy = mosY > 1 ? stepH * (iy - (mosY - 1) / 2) : 0;
          const corners: [number, number][] = [
            [pcx - pw, pcy - ph], [pcx + pw, pcy - ph],
            [pcx + pw, pcy + ph], [pcx - pw, pcy + ph]
          ];
          ctx.beginPath();
          for (let k = 0; k < 4; k++) {
            const [rx, ry] = rot(corners[k][0], corners[k][1]);
            if (k === 0) ctx.moveTo(cx + rx, cy + ry);
            else ctx.lineTo(cx + rx, cy + ry);
          }
          ctx.closePath();
          ctx.stroke();
        }
      }

      // Outer mosaic boundary
      if (mosX > 1 || mosY > 1) {
        ctx.strokeStyle = "rgba(255,120,60,0.7)";
        ctx.lineWidth = 1 * dpr;
        ctx.setLineDash([6 * dpr, 4 * dpr]);
        const outer: [number, number][] = [
          [-totalHW, -totalHH], [totalHW, -totalHH],
          [totalHW, totalHH], [-totalHW, totalHH]
        ];
        ctx.beginPath();
        for (let k = 0; k < 4; k++) {
          const [rx, ry] = rot(outer[k][0], outer[k][1]);
          if (k === 0) ctx.moveTo(cx + rx, cy + ry);
          else ctx.lineTo(cx + rx, cy + ry);
        }
        ctx.closePath();
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // FoV label
      const fovW = hwRad * 2 * 180 / Math.PI;
      const fovH = hhRad * 2 * 180 / Math.PI;
      let label: string;
      if (mosX > 1 || mosY > 1) {
        const tfW = fovW * mosX - fovW * olap * (mosX - 1);
        const tfH = fovH * mosY - fovH * olap * (mosY - 1);
        label = `${fovW.toFixed(2)}°×${fovH.toFixed(2)}°  mosaic ${tfW.toFixed(1)}°×${tfH.toFixed(1)}°`;
      } else {
        label = `${fovW.toFixed(2)}°×${fovH.toFixed(2)}°`;
      }
      const [trx, try_] = rot(totalHW, -totalHH);
      ctx.fillStyle = "rgba(255,100,100,0.86)";
      ctx.fillText(label, cx + trx + 4 * dpr, cy + try_ - 4 * dpr);
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

  /* ── label placement helper ── */
  function placeLabel(
    cx_: number, cy_: number, radius: number, tw: number, th: number,
    rects: [number, number, number, number][]
  ): [number, number] {
    const rd = radius + 3;
    const cands: [number, number][] = [
      [cx_ + rd, cy_ - 2], [cx_ + rd, cy_ + th], [cx_ + rd, cy_ - th],
      [cx_ - tw - rd, cy_ - 2], [cx_ - tw / 2, cy_ - rd - 2],
      [cx_ - tw / 2, cy_ + rd + th], [cx_ - tw - rd, cy_ - th],
      [cx_ - tw - rd, cy_ + th],
    ];
    let best = cands[0];
    for (const [tx, ty] of cands) {
      const r: [number, number, number, number] = [tx, ty - th, tx + tw, ty];
      let overlap = false;
      for (const o of rects) {
        if (!(r[2] < o[0] || r[0] > o[2] || r[3] < o[1] || r[1] > o[3])) { overlap = true; break; }
      }
      if (!overlap) { best = [tx, ty]; break; }
    }
    return best;
  }

  /* ── planetary nebulae ── */
  function drawPN(
    ctx: CanvasRenderingContext2D, sc: number, c: ProjCenter,
    cx: number, cy: number, W: number, H: number, fovDeg: number
  ) {
    if (!showPNRef.current || pnData.current.length === 0) return;
    const lineW = Math.max(0.4, Math.min(2.2, 30 / fovDeg));
    const alpha = Math.max(140, Math.min(240, Math.round(600 / fovDeg)));
    const a = (alpha / 255).toFixed(2);
    const showAll = fovDeg < 3;
    const showBig = fovDeg < 30;
    ctx.lineWidth = lineW;
    ctx.setLineDash([4, 3]);
    const dpr = window.devicePixelRatio || 1;
    const labelRects: [number, number, number, number][] = [];

    for (const row of pnData.current) {
      const [ra, dec, radDeg, hasSize, isCand, label] = row;
      const [x, y, cc] = stereoFwd(ra, dec, c);
      if (cc < -0.2) continue;
      const sx = cx - x * sc;
      const sy = cy - y * sc;
      if (sx < -200 || sx > W + 200 || sy < -200 || sy > H + 200) continue;
      const rPx = Math.max(radDeg * (Math.PI / 180) * sc, PN_MIN_R);
      if (isCand) ctx.strokeStyle = `rgba(255,60,60,${a})`;
      else if (hasSize) ctx.strokeStyle = `rgba(0,200,100,${a})`;
      else ctx.strokeStyle = `rgba(255,160,40,${a})`;
      ctx.beginPath();
      ctx.arc(sx, sy, rPx, 0, Math.PI * 2);
      ctx.stroke();

      if (showAll || (showBig && rPx > 10)) {
        if (label) {
          ctx.font = `${14 * dpr}px sans-serif`;
          const tw = ctx.measureText(label).width;
          const th = 14 * dpr;
          const [tx, ty] = placeLabel(sx, sy, rPx, tw, th, labelRects);
          ctx.fillStyle = `rgba(180,220,180,${a})`;
          ctx.fillText(label, tx, ty);
          labelRects.push([tx, ty - th, tx + tw, ty]);
        }
      }
    }
    ctx.setLineDash([]);
  }

  /* ── supernova remnants ── */
  function drawSNR(
    ctx: CanvasRenderingContext2D, sc: number, c: ProjCenter,
    cx: number, cy: number, W: number, H: number, fovDeg: number
  ) {
    if (!showSNRRef.current || snrData.current.length === 0) return;
    const lineW = Math.max(0.4, Math.min(2.2, 30 / fovDeg));
    const alpha = Math.max(140, Math.min(240, Math.round(600 / fovDeg)));
    const a = (alpha / 255).toFixed(2);
    const showAll = fovDeg < 10;
    const showBig = fovDeg < 30;
    ctx.lineWidth = lineW;
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = `rgba(60,160,255,${a})`;
    const dpr = window.devicePixelRatio || 1;
    const labelRects: [number, number, number, number][] = [];

    for (const row of snrData.current) {
      const [ra, dec, radDeg, label] = row;
      const [x, y, cc] = stereoFwd(ra, dec, c);
      if (cc < -0.2) continue;
      const sx = cx - x * sc;
      const sy = cy - y * sc;
      if (sx < -300 || sx > W + 300 || sy < -300 || sy > H + 300) continue;
      const rPx = Math.max(radDeg * (Math.PI / 180) * sc, SNR_MIN_R);
      ctx.beginPath();
      ctx.arc(sx, sy, rPx, 0, Math.PI * 2);
      ctx.stroke();

      if (showAll || (showBig && rPx > 10)) {
        if (label) {
          ctx.font = `${14 * dpr}px sans-serif`;
          const tw = ctx.measureText(label).width;
          const th = 14 * dpr;
          const [tx, ty] = placeLabel(sx, sy, rPx, tw, th, labelRects);
          ctx.fillStyle = `rgba(160,200,255,${a})`;
          ctx.fillText(label, tx, ty);
          labelRects.push([tx, ty - th, tx + tw, ty]);
        }
      }
    }
    ctx.setLineDash([]);
  }

  /* ── DSO (Messier/NGC/IC/Sh2) ── */
  function drawDSO(
    ctx: CanvasRenderingContext2D, sc: number, c: ProjCenter,
    cx: number, cy: number, W: number, H: number, fovDeg: number
  ) {
    const data = dsoData.current;
    if (data.length === 0) return;
    const catShow = [showMessierRef.current, showNGCRef.current, showICRef.current, showSh2Ref.current];
    if (!catShow.some(Boolean)) return;

    const lineW = Math.max(0.4, Math.min(2.2, 30 / fovDeg));
    const alpha = Math.max(100, Math.min(220, Math.round(500 / fovDeg)));
    const a = (alpha / 255).toFixed(2);
    const showAll = fovDeg < 5;
    const showBig = fovDeg < 30;
    ctx.lineWidth = lineW;
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = `rgba(220,220,220,${a})`;
    const dpr = window.devicePixelRatio || 1;
    const labelRects: [number, number, number, number][] = [];

    for (const row of data) {
      const [ra, dec, radDeg, , catCode, label] = row;
      if (!catShow[catCode]) continue;
      const [x, y, cc] = stereoFwd(ra, dec, c);
      if (cc < -0.2) continue;
      const sx = cx - x * sc;
      const sy = cy - y * sc;
      if (sx < -200 || sx > W + 200 || sy < -200 || sy > H + 200) continue;
      const rPx = Math.max(radDeg * (Math.PI / 180) * sc, DSO_MIN_R);
      ctx.beginPath();
      ctx.arc(sx, sy, rPx, 0, Math.PI * 2);
      ctx.stroke();

      if (showAll || (showBig && rPx > 10)) {
        if (label) {
          ctx.font = `${14 * dpr}px sans-serif`;
          const tw = ctx.measureText(label).width;
          const th = 14 * dpr;
          const [tx, ty] = placeLabel(sx, sy, rPx, tw, th, labelRects);
          ctx.fillStyle = `rgba(220,220,220,${a})`;
          ctx.fillText(label, tx, ty);
          labelRects.push([tx, ty - th, tx + tw, ty]);
        }
      }
    }
    ctx.setLineDash([]);
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
      showCrosshairRef.current = false;
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
    const [gl, gb] = eqToGal(raDeg, decDeg);
    setCoordText(`RA: ${String(h).padStart(2, "0")}h ${String(m).padStart(2, "0")}m ${s}s   Dec: ${sign}${String(dd).padStart(2, "0")}° ${String(dm).padStart(2, "0")}'   l: ${gl.toFixed(2)}°  b: ${gb.toFixed(2)}°`);

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

      {/* Catalog toggle toolbar */}
      <div className="flex items-center gap-1.5 px-3 py-1 bg-[#111118] border-b border-white/5 shrink-0 flex-wrap">
        <ToggleBtn label="PN" on={showPN} bg="linear-gradient(90deg,rgba(255,60,60,.7),rgba(255,160,40,.7),rgba(0,200,100,.7))" color="#fff"
          onClick={() => { const v = !showPN; setShowPN(v); showPNRef.current = v; needsDraw.current = true; }} />
        <ToggleBtn label="SNR" on={showSNR} bg="rgba(60,160,255,.7)" color="#fff"
          onClick={() => { const v = !showSNR; setShowSNR(v); showSNRRef.current = v; needsDraw.current = true; }} />
        <ToggleBtn label="Messier" on={showMessier} bg="rgba(220,220,220,.7)" color="#111"
          onClick={() => { const v = !showMessier; setShowMessier(v); showMessierRef.current = v; needsDraw.current = true; }} />
        <ToggleBtn label="NGC" on={showNGC} bg="rgba(220,220,220,.7)" color="#111"
          onClick={() => { const v = !showNGC; setShowNGC(v); showNGCRef.current = v; needsDraw.current = true; }} />
        <ToggleBtn label="IC" on={showIC} bg="rgba(220,220,220,.7)" color="#111"
          onClick={() => { const v = !showIC; setShowIC(v); showICRef.current = v; needsDraw.current = true; }} />
        <ToggleBtn label="Sh2" on={showSh2} bg="rgba(220,220,220,.7)" color="#111"
          onClick={() => { const v = !showSh2; setShowSh2(v); showSh2Ref.current = v; needsDraw.current = true; }} />

        <div className="w-px h-4 bg-white/10 mx-1" />

        {/* Grid toggles */}
        <ToggleBtn label="赤道网格" on={showEqGrid} bg="rgba(34,34,68,.8)" color="#aaf"
          onClick={() => { const v = !showEqGrid; setShowEqGrid(v); showEqGridRef.current = v; needsDraw.current = true; }} />
        <ToggleBtn label="银道网格" on={showGalGrid} bg="rgba(200,200,220,.35)" color="#fff"
          onClick={() => { const v = !showGalGrid; setShowGalGrid(v); showGalGridRef.current = v; needsDraw.current = true; }} />

        <div className="w-px h-4 bg-white/10 mx-1" />

        {/* Camera sim toggle */}
        <button
          onClick={() => {
            const v = !showCamSim;
            setShowCamSim(v);
            showCamSimRef.current = v;
            if (v && camEntries.length === 0) {
              const init: CamConfig[] = [{ focal: 500, sw: 36, sh: 24, angle: 0, mosX: 1, mosY: 1, overlap: 20 }];
              setCamEntries(init);
              camEntriesRef.current = init;
            }
            needsDraw.current = true;
          }}
          className={`px-2.5 py-0.5 rounded text-xs font-semibold transition-all select-none border ${
            showCamSim
              ? "bg-red-500/70 border-red-400/60 text-white shadow-[0_0_8px_rgba(255,60,60,.4)]"
              : "bg-transparent border-amber-400/50 text-amber-300/90 hover:bg-amber-500/15"
          }`}
        >
          📷 相机视场模拟
        </button>
      </div>

      {/* Coordinate + name search row */}
      <CoordJumpRow
        jumpTo={(ra, dec, f) => {
          centerRA.current = ra; centerDec.current = dec;
          if (f !== undefined) fov.current = f;
          showCrosshairRef.current = true;
          needsDraw.current = true;
        }}
        searchQuery={searchQuery}
        onSearchInput={handleSearchInput}
        onSearchSubmit={handleSearchSubmit}
        searchResults={searchResults}
        showDropdown={showSearchDropdown}
        setShowDropdown={setShowSearchDropdown}
      />

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

        {/* Camera simulator panel */}
        {showCamSim && (
          <div className="absolute top-2 right-2 w-80 rounded-lg bg-black/85 backdrop-blur-sm border border-white/10 p-2.5 text-xs text-white/80 z-40 max-h-[60vh] overflow-y-auto">
            <div className="font-semibold text-sm text-white/90 mb-1.5">📷 相机视场模拟</div>
            {camEntries.map((cfg, i) => (
              <div key={i} className="mb-2 p-1.5 rounded bg-white/5 border border-white/5">
                <div className="flex items-center gap-1 flex-wrap mb-1">
                  <span className="text-white/40">f</span>
                  <input type="number" value={cfg.focal} onChange={e => updateCamEntry(i, "focal", e.target.value)}
                    className="w-20 px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-white/80 text-xs text-center outline-none" />
                  <span className="text-white/40">mm</span>
                  <input type="number" value={cfg.sw} onChange={e => updateCamEntry(i, "sw", e.target.value)}
                    className="w-16 px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-white/80 text-xs text-center outline-none" />
                  <span className="text-white/40">×</span>
                  <input type="number" value={cfg.sh} onChange={e => updateCamEntry(i, "sh", e.target.value)}
                    className="w-16 px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-white/80 text-xs text-center outline-none" />
                  <span className="text-white/40">mm</span>
                  <span className="text-white/40">∠</span>
                  <input type="number" value={cfg.angle} onChange={e => updateCamEntry(i, "angle", e.target.value)}
                    className="w-16 px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-white/80 text-xs text-center outline-none" />
                  <span className="text-white/40">°</span>
                  <button onClick={() => removeCamEntry(i)}
                    className="ml-auto px-1 py-0.5 rounded bg-red-500/40 text-white/80 hover:bg-red-400/60 text-xs">×</button>
                </div>
                <div className="flex items-center gap-1 flex-wrap">
                  <span className="text-white/40">Mosaic</span>
                  <input type="number" value={cfg.mosX} onChange={e => updateCamEntry(i, "mosX", e.target.value)}
                    className="w-12 px-1 py-0.5 rounded bg-white/5 border border-white/10 text-white/80 text-xs text-center outline-none" />
                  <span className="text-white/40">×</span>
                  <input type="number" value={cfg.mosY} onChange={e => updateCamEntry(i, "mosY", e.target.value)}
                    className="w-12 px-1 py-0.5 rounded bg-white/5 border border-white/10 text-white/80 text-xs text-center outline-none" />
                  <span className="text-white/40">重叠</span>
                  <input type="number" value={cfg.overlap} onChange={e => updateCamEntry(i, "overlap", e.target.value)}
                    className="w-16 px-1 py-0.5 rounded bg-white/5 border border-white/10 text-white/80 text-xs text-center outline-none" />
                  <span className="text-white/40">%</span>
                </div>
              </div>
            ))}
            <button onClick={addCamEntry}
              className="w-full py-1 rounded bg-indigo-500/40 text-white/80 hover:bg-indigo-400/60 text-xs">
              + 添加视场
            </button>
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
              {info.telescope && <div>望远镜焦比: {info.telescope}</div>}
              {info.exposure && <div>单块曝光时间: {info.exposure}</div>}
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
