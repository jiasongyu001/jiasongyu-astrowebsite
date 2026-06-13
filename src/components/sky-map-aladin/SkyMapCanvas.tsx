"use client";

import { useRef, useEffect, useCallback, useState } from "react";
import { Search } from "lucide-react";
import { stereoFwd, stereoInv, makeCenter, computeScale, eqToGal, galToEq } from "./projection";
import { CONSTELLATION_LINES } from "./constellations";
import type { ProjCenter } from "./projection";
import { useUserData } from "@/components/user-data-provider";
import type { CameraCandidateTarget, CameraConfig, SkyMapState } from "@/lib/user-data";

/* ── types ── */
interface Star {
  ra: number;  // degrees
  dec: number;
  mag: number;
  ci: number;  // B-V color index
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
  previewFailed?: boolean;
  detailFailed?: boolean;
  lastVisibleFrame?: number;
  imgLod?: number;
  pendingImg?: HTMLImageElement;
  pendingLod?: number;
}

type PhotoGLRenderer = {
  canvas: HTMLCanvasElement;
  gl: WebGLRenderingContext;
  program: WebGLProgram;
  positionBuffer: WebGLBuffer;
  texCoordBuffer: WebGLBuffer;
  positionLocation: number;
  texCoordLocation: number;
  resolutionLocation: WebGLUniformLocation;
  homographyLocation: WebGLUniformLocation;
  opacityLocation: WebGLUniformLocation;
  textures: Map<HTMLImageElement, { texture: WebGLTexture; lastUsedFrame: number }>;
  frame: number;
};

type NSNSAladin = {
  gotoRaDec: (ra: number, dec: number) => void;
  setFoV: (fov: number) => void;
  getRaDec: () => [number, number];
  getFov: () => [number, number];
  createImageSurvey: (
    id: string, name: string, url: string, frame: string, order: number,
    options: { imgFormat: string }
  ) => unknown;
  setBaseImageLayer: (survey: unknown) => void;
};

type NSNSAladinApi = {
  init: Promise<unknown>;
  aladin: (element: string | HTMLElement, options: Record<string, unknown>) => NSNSAladin;
};

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
const trimTrailingSlash = (value: string) => value.replace(/\/+$/, "");
const ALADIN_ASSET_ORIGIN = trimTrailingSlash(
  process.env.NEXT_PUBLIC_DSSM_ALADIN_ASSET_ORIGIN
    ?? (process.env.NODE_ENV === "production"
      ? "https://dssm-aladin-assets.jsyastro.com"
      : "http://127.0.0.1:3011"),
);
const SKYMAP_ASSET_URL = `${ALADIN_ASSET_ORIGIN}/skymap`;
const NSNS_MODULE_URL = `${ALADIN_ASSET_ORIGIN}/web_viewer/node_modules/aladin-lite/dist/aladin.js`;
const NSNS_HIPS_URL = `${ALADIN_ASSET_ORIGIN}/NSNS_DR0.2_OIII_nonlinear_HiPS`;
const NSNS_HALPHA_HIPS_URL = `${ALADIN_ASSET_ORIGIN}/NSNS_DR0.2_Halpha_nonlinear_HiPS`;
const NSNS_ORDER6_COVERAGE_URL = `${SKYMAP_ASSET_URL}/nsns_order6_coverage.json`;
const NSNS_MAX_ORDER = 5;
const NSNS_OIII_COLOR = "#32C8FF";
const NSNS_HALPHA_COLOR = "#FF2424";
const PHOTO_LOD_LEVELS = [256, 512, 1024, 2048] as const;
const GUEST_PHOTO_MAX_LOD = 1024;
const DSO_COLOR = [199, 125, 255] as const;

function healpixNestAng2pix(order: number, raDeg: number, decDeg: number): number {
  const nside = 2 ** order;
  const z = Math.sin(decDeg * Math.PI / 180);
  const za = Math.abs(z);
  const tt = (((raDeg % 360) + 360) % 360) / 90;
  let face: number;
  let ix: number;
  let iy: number;

  if (za <= 2 / 3) {
    const temp1 = nside * (0.5 + tt);
    const temp2 = nside * z * 0.75;
    const jp = Math.floor(temp1 - temp2);
    const jm = Math.floor(temp1 + temp2);
    const ifp = Math.floor(jp / nside);
    const ifm = Math.floor(jm / nside);
    face = ifp === ifm ? (ifp | 4) : ifp < ifm ? ifp : ifm + 8;
    ix = jm & (nside - 1);
    iy = nside - (jp & (nside - 1)) - 1;
  } else {
    const ntt = Math.min(3, Math.floor(tt));
    const tp = tt - ntt;
    const tmp = nside * Math.sqrt(3 * (1 - za));
    const jp = Math.min(nside - 1, Math.floor(tp * tmp));
    const jm = Math.min(nside - 1, Math.floor((1 - tp) * tmp));
    if (z >= 0) {
      face = ntt;
      ix = nside - jm - 1;
      iy = nside - jp - 1;
    } else {
      face = ntt + 8;
      ix = jp;
      iy = jm;
    }
  }

  let nestedX = 0;
  let nestedY = 0;
  for (let bit = 0; bit < order; bit++) {
    nestedX |= ((ix >> bit) & 1) << (2 * bit);
    nestedY |= ((iy >> bit) & 1) << (2 * bit + 1);
  }
  return face * nside * nside + nestedX + nestedY;
}

/* ── BV color index → RGB ── */
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

/* ── precompute star display props ── */
function starRadius(mag: number): number {
  const t = Math.max(0, (MAG_LIMIT - mag)) / (MAG_LIMIT + 1);
  return 1 + 5 * t * t;
}
function starAlpha(mag: number): number {
  return Math.min(255, Math.max(80, Math.round(80 + 175 * (1 - mag / MAG_LIMIT))));
}

function formatDecimalDeg(value: number): string {
  return value.toFixed(5);
}

function formatRaHms(raDeg: number): string {
  const secondsPerDay = 24 * 3600;
  let totalSeconds = Math.round(((((raDeg / 15) % 24) + 24) % 24) * 3600) % secondsPerDay;
  const h = Math.floor(totalSeconds / 3600);
  totalSeconds -= h * 3600;
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds - m * 60;
  return `${String(h).padStart(2, "0")}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
}

function formatDms(value: number): string {
  const sign = value < 0 ? "-" : "+";
  let totalSeconds = Math.round(Math.abs(value) * 3600);
  const deg = Math.floor(totalSeconds / 3600);
  totalSeconds -= deg * 3600;
  const min = Math.floor(totalSeconds / 60);
  const sec = totalSeconds - min * 60;
  return `${sign}${String(deg).padStart(2, "0")}° ${String(min).padStart(2, "0")}' ${String(sec).padStart(2, "0")}"`;
}

type CoordText = {
  ra: string;
  dec: string;
  l: string;
  b: string;
};

const EMPTY_COORD_TEXT: CoordText = {
  ra: "RA: --",
  dec: "Dec: --",
  l: "l: --",
  b: "b: --",
};

function formatCoordinateText(raDeg: number, decDeg: number): CoordText {
  const [gl, gb] = eqToGal(raDeg, decDeg);
  return {
    ra: `RA: ${formatRaHms(raDeg)}`,
    dec: `Dec: ${formatDms(decDeg)}`,
    l: `l: ${formatDecimalDeg(gl)}°`,
    b: `b: ${formatDecimalDeg(gb)}°`,
  };
}

function clampDec(value: number): number {
  return Math.max(-90, Math.min(90, value));
}

/* ── toggle button ── */
function ToggleBtn({ label, on, bg, color, onClick, disabled = false }: {
  label: string; on: boolean; bg: string; color: string; onClick: () => void; disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="px-2.5 py-1 rounded text-[13px] font-medium transition-all select-none disabled:cursor-not-allowed disabled:opacity-35"
      style={{
        background: on ? bg : "rgba(60,60,60,.7)",
        color: on ? color : "#888",
      }}
    >
      {on ? "☑" : "☐"} {label}
    </button>
  );
}

/* ── sidebar coordinate / search section ── */
function SidebarCoordSection({ jumpTo, searchQuery, onSearchInput, onSearchSubmit, searchResults, showDropdown, setShowDropdown }: {
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
  const [glInput, setGlInput] = useState("");
  const [gbInput, setGbInput] = useState("");

  const doRaDec = () => {
    const h = parseFloat(raH || "0"), m = parseFloat(raM || "0"), s = parseFloat(raS || "0");
    const dd = parseFloat(decD || "0"), dm = parseFloat(decM || "0"), ds = parseFloat(decS || "0");
    const ra = (h + m / 60 + s / 3600) * 15;
    const sign = dd < 0 ? -1 : 1;
    const dec = sign * (Math.abs(dd) + dm / 60 + ds / 3600);
    jumpTo(((ra % 360) + 360) % 360, clampDec(dec));
  };

  const doGal = () => {
    const l = parseFloat(glInput || "0");
    const b = parseFloat(gbInput || "0");
    const [ra, dec] = galToEq(((l % 360) + 360) % 360, clampDec(b));
    jumpTo(ra, dec);
  };

  const inp = "w-full px-2 py-1 rounded text-[13px] bg-white/5 border border-white/10 text-white/80 outline-none focus:border-indigo-400/50 text-center";
  const smallInp = "w-[4rem] px-1.5 py-1 rounded text-[13px] bg-white/5 border border-white/10 text-white/80 outline-none focus:border-indigo-400/50 text-center";
  return (
    <>
      {/* ── Name search ── */}
      <div className="relative">
        <div className="text-white/40 text-[13px] mb-1">名称搜索</div>
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onSearchSubmit(); } }}
            onFocus={() => { if (searchResults.length > 0) setShowDropdown(true); }}
            onBlur={() => { setTimeout(() => setShowDropdown(false), 200); }}
            placeholder="天体名称"
            className="flex-1 min-w-0 px-2 py-1 rounded text-[13px] bg-white/5 border border-white/10 text-white/80 placeholder:text-white/20 outline-none focus:border-indigo-400/50"
          />
          <button onClick={onSearchSubmit} className="px-2.5 py-1 rounded text-[13px] bg-indigo-500/60 text-white/90 hover:bg-indigo-400/70 transition-colors shrink-0">跳转</button>
        </div>
        {showDropdown && searchResults.length > 0 && (
          <div className="absolute top-full left-0 mt-0.5 w-full max-h-52 overflow-y-auto rounded bg-[#1a1a2e]/95 border border-white/10 shadow-lg z-50">
            {searchResults.map((r, i) => (
              <div key={i} className="px-2.5 py-1.5 text-xs text-white/80 hover:bg-indigo-500/30 cursor-pointer truncate"
                onMouseDown={(e) => { e.preventDefault(); jumpTo(r.ra, r.dec, r.fov); onSearchInput(r.label); }}>
                {r.label}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="h-px bg-white/5 my-1.5" />

      {/* ── Equatorial coordinate jump ── */}
      <div>
        <div className="text-white/40 text-[13px] mb-1">赤道坐标</div>
        <div className="flex items-center gap-1.5 mb-1">
          <span className="text-white/50 text-[13px] w-14 shrink-0">RA 赤经</span>
          <input className={smallInp} value={raH} onChange={e=>setRaH(e.target.value)} placeholder="h" onKeyDown={e=>{if(e.key==="Enter")doRaDec();}} />
          <input className={smallInp} value={raM} onChange={e=>setRaM(e.target.value)} placeholder="m" onKeyDown={e=>{if(e.key==="Enter")doRaDec();}} />
          <input className={smallInp} value={raS} onChange={e=>setRaS(e.target.value)} placeholder="s" onKeyDown={e=>{if(e.key==="Enter")doRaDec();}} />
        </div>
        <div className="flex items-center gap-1.5 mb-1">
          <span className="text-white/50 text-[13px] w-14 shrink-0">Dec 赤纬</span>
          <input className={smallInp} value={decD} onChange={e=>setDecD(e.target.value)} placeholder="°" onKeyDown={e=>{if(e.key==="Enter")doRaDec();}} />
          <input className={smallInp} value={decM} onChange={e=>setDecM(e.target.value)} placeholder="′" onKeyDown={e=>{if(e.key==="Enter")doRaDec();}} />
          <input className={smallInp} value={decS} onChange={e=>setDecS(e.target.value)} placeholder="″" onKeyDown={e=>{if(e.key==="Enter")doRaDec();}} />
        </div>
        <button onClick={doRaDec} className="w-full py-1 rounded text-[13px] bg-indigo-500/60 text-white/90 hover:bg-indigo-400/70">跳转</button>
      </div>

      <div className="h-px bg-white/5 my-1.5" />

      {/* ── Galactic coordinate jump ── */}
      <div>
        <div className="text-white/40 text-[13px] mb-1">银道坐标</div>
        <div className="flex items-center gap-1.5 mb-1">
          <span className="text-white/50 text-[13px] w-14 shrink-0">l 银经</span>
          <input className={inp} value={glInput} onChange={e=>setGlInput(e.target.value)} placeholder="0.00000°" onKeyDown={e=>{if(e.key==="Enter")doGal();}} />
        </div>
        <div className="flex items-center gap-1.5 mb-1">
          <span className="text-white/50 text-[13px] w-14 shrink-0">b 银纬</span>
          <input className={inp} value={gbInput} onChange={e=>setGbInput(e.target.value)} placeholder="0.00000°" onKeyDown={e=>{if(e.key==="Enter")doGal();}} />
        </div>
        <button onClick={doGal} className="w-full py-1 rounded text-[13px] bg-indigo-500/60 text-white/90 hover:bg-indigo-400/70">跳转</button>
      </div>
    </>
  );
}

export default function SkyMapCanvas() {
  const {
    user,
    document: userDocument,
    documentLoaded,
    syncStatus,
    saveCameraCandidateTarget,
    deleteCameraCandidateTarget,
    setCameraEntries,
    setMapState,
  } = useUserData();
  const hasFullResolution = Boolean(user);
  const hasFullResolutionRef = useRef(hasFullResolution);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const layerCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const photoGLRendererRef = useRef<PhotoGLRenderer | null>(null);
  const photoLayerCacheRef = useRef<HTMLCanvasElement | null>(null);
  const photoLayerCacheKeyRef = useRef("");
  const photoLayerVersionRef = useRef(0);
  const photoLoadQueueRef = useRef<(() => void)[]>([]);
  const activePhotoLoadsRef = useRef(0);
  const nsnsHostRef = useRef<HTMLDivElement>(null);
  const nsnsAladinRef = useRef<NSNSAladin | null>(null);
  const nsnsRequestedViewRef = useRef("");
  const nsnsAbovePhotosRef = useRef(false);
  const nsnsOrder6TilesRef = useRef<Set<number> | null>(null);
  const nsnsHalphaHostRef = useRef<HTMLDivElement>(null);
  const nsnsHalphaAladinRef = useRef<NSNSAladin | null>(null);
  const nsnsHalphaRequestedViewRef = useRef("");
  const nsnsHalphaAbovePhotosRef = useRef(false);

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
  const dragStartView = useRef<{ ra: number; dec: number } | null>(null);
  const activePointerId = useRef<number | null>(null);
  const isDraggingView = useRef(false);
  const animId = useRef(0);
  const needsDraw = useRef(true);
  const pointerUiFrame = useRef<number | null>(null);
  const centerCoordFrame = useRef<number | null>(null);
  const pendingPointerUi = useRef<{ coord: CoordText; hover: Overlay | null } | null>(null);
  const lastCoordText = useRef<CoordText>(EMPTY_COORD_TEXT);
  const lastCenterCoordText = useRef(formatCoordinateText(0, 30));
  const lastHoverOverlay = useRef<Overlay | null>(null);

  const pnData = useRef<PNRow[]>([]);
  const snrData = useRef<SNRRow[]>([]);
  const dsoData = useRef<DSORow[]>([]);

  const [coordText, setCoordText] = useState<CoordText>(EMPTY_COORD_TEXT);
  const [centerCoordText, setCenterCoordText] = useState(() => formatCoordinateText(0, 30));
  const [viewRevision, setViewRevision] = useState(0);
  const [hoverOverlay, setHoverOverlay] = useState<Overlay | null>(null);
  const [selectedOverlay, setSelectedOverlay] = useState<Overlay | null>(null);
  const [detailLoading, setDetailLoading] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showDeepSkyPhotos, setShowDeepSkyPhotos] = useState(true);
  const showDeepSkyPhotosRef = useRef(true);
  const [showNSNS, setShowNSNS] = useState(false);
  const [nsnsOpacity, setNSNSOpacity] = useState(100);
  const [nsnsBrightness, setNSNSBrightness] = useState(100);
  const [nsnsColorized, setNSNSColorized] = useState(false);
  const [nsnsControlsExpanded, setNSNSControlsExpanded] = useState(false);
  const [nsnsStatus, setNSNSStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const showNSNSRef = useRef(false);
  const nsnsOpacityRef = useRef(1);
  const nsnsBrightnessRef = useRef(100);
  const nsnsColorizedRef = useRef(false);
  const [showNSNSHalpha, setShowNSNSHalpha] = useState(false);
  const [nsnsHalphaOpacity, setNSNSHalphaOpacity] = useState(100);
  const [nsnsHalphaBrightness, setNSNSHalphaBrightness] = useState(100);
  const [nsnsHalphaColorized, setNSNSHalphaColorized] = useState(false);
  const [nsnsHalphaControlsExpanded, setNSNSHalphaControlsExpanded] = useState(false);
  const [nsnsHalphaStatus, setNSNSHalphaStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const showNSNSHalphaRef = useRef(false);
  const nsnsHalphaOpacityRef = useRef(1);
  const nsnsHalphaBrightnessRef = useRef(100);
  const nsnsHalphaColorizedRef = useRef(false);

  const requestDraw = useCallback(() => {
    needsDraw.current = true;
  }, []);

  function invalidatePhotoLayer() {
    photoLayerVersionRef.current += 1;
    photoLayerCacheKeyRef.current = "";
    requestDraw();
  }

  const flushCenterCoord = useCallback(() => {
    centerCoordFrame.current = null;
    const next = formatCoordinateText(centerRA.current, centerDec.current);
    if (
      next.ra === lastCenterCoordText.current.ra &&
      next.dec === lastCenterCoordText.current.dec &&
      next.l === lastCenterCoordText.current.l &&
      next.b === lastCenterCoordText.current.b
    ) return;
    lastCenterCoordText.current = next;
    setCenterCoordText(next);
  }, []);

  const updateCenterCoord = useCallback((immediate = false) => {
    if (immediate) {
      if (centerCoordFrame.current !== null) {
        cancelAnimationFrame(centerCoordFrame.current);
        centerCoordFrame.current = null;
      }
      flushCenterCoord();
      return;
    }
    if (centerCoordFrame.current !== null) return;
    centerCoordFrame.current = requestAnimationFrame(flushCenterCoord);
  }, [flushCenterCoord]);

  const queuePointerUi = useCallback((coord: CoordText, hover: Overlay | null) => {
    pendingPointerUi.current = { coord, hover };
    if (pointerUiFrame.current !== null) return;
    pointerUiFrame.current = window.requestAnimationFrame(() => {
      pointerUiFrame.current = null;
      const next = pendingPointerUi.current;
      pendingPointerUi.current = null;
      if (!next) return;
      if (
        next.coord.ra !== lastCoordText.current.ra ||
        next.coord.dec !== lastCoordText.current.dec ||
        next.coord.l !== lastCoordText.current.l ||
        next.coord.b !== lastCoordText.current.b
      ) {
        lastCoordText.current = next.coord;
        setCoordText(next.coord);
      }
      if (next.hover !== lastHoverOverlay.current) {
        lastHoverOverlay.current = next.hover;
        setHoverOverlay(next.hover);
      }
    });
  }, []);

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

  /* ── center crosshair ── */
  const [showCenterCrosshair, setShowCenterCrosshair] = useState(false);
  const showCenterCrosshairRef = useRef(false);

  /* ── camera simulator ── */
  type CamConfig = CameraConfig;
  const [showCamSim, setShowCamSim] = useState(false);
  const [camEntries, setCamEntries] = useState<CamConfig[]>([]);
  const camEntriesRef = useRef<CamConfig[]>([]);
  const showCamSimRef = useRef(false);
  const [candidateNames, setCandidateNames] = useState<Record<string, string>>({});
  const [candidateGroupsCollapsed, setCandidateGroupsCollapsed] = useState<Record<string, boolean>>({});
  const [searchToolsExpanded, setSearchToolsExpanded] = useState(false);
  const restoredUserRef = useRef<string | null>(null);
  const cameraCandidateTargetsRef = useRef<CameraCandidateTarget[]>([]);

  useEffect(() => {
    cameraCandidateTargetsRef.current = userDocument.cameraCandidateTargets;
    requestDraw();
  }, [requestDraw, userDocument.cameraCandidateTargets]);

  useEffect(() => {
    hasFullResolutionRef.current = hasFullResolution;
    if (!hasFullResolution) {
      setShowNSNS(false);
      showNSNSRef.current = false;
      setShowNSNSHalpha(false);
      showNSNSHalphaRef.current = false;
    }
    for (const overlay of overlays.current) {
      overlay.showDetail = false;
      overlay.detailImg = undefined;
      if (!hasFullResolution && (overlay.imgLod ?? 0) > GUEST_PHOTO_MAX_LOD) {
        overlay.img = undefined;
        overlay.imgLod = undefined;
        overlay.pendingImg = undefined;
        overlay.pendingLod = undefined;
      }
    }
    setSelectedOverlay(null);
    setDetailLoading(null);
    nsnsAladinRef.current = null;
    nsnsRequestedViewRef.current = "";
    nsnsHalphaAladinRef.current = null;
    nsnsHalphaRequestedViewRef.current = "";
    if (nsnsHostRef.current) nsnsHostRef.current.replaceChildren();
    if (nsnsHalphaHostRef.current) nsnsHalphaHostRef.current.replaceChildren();
    invalidatePhotoLayer();
    requestDraw();
  }, [hasFullResolution, requestDraw]);

  useEffect(() => {
    if (!user || !documentLoaded || restoredUserRef.current === user.id) return;
    restoredUserRef.current = user.id;
    const restoredEntries = userDocument.cameraEntries.map(normalizeCamEntry);
    const state = userDocument.mapState;
    if (!state) {
      if (restoredEntries.length > 0) {
        setCamEntries(restoredEntries);
        camEntriesRef.current = restoredEntries;
      }
      requestDraw();
      return;
    }
    centerRA.current = state.centerRA;
    centerDec.current = state.centerDec;
    fov.current = state.fov;
    setShowDeepSkyPhotos(state.showDeepSkyPhotos);
    showDeepSkyPhotosRef.current = state.showDeepSkyPhotos;
    setShowNSNS(Boolean(user) && state.showNSNS);
    showNSNSRef.current = Boolean(user) && state.showNSNS;
    setNSNSOpacity(state.nsnsOpacity);
    nsnsOpacityRef.current = state.nsnsOpacity / 100;
    setNSNSBrightness(state.nsnsBrightness);
    nsnsBrightnessRef.current = state.nsnsBrightness;
    setNSNSColorized(state.nsnsColorized);
    nsnsColorizedRef.current = state.nsnsColorized;
    setShowNSNSHalpha(Boolean(user) && state.showNSNSHalpha);
    showNSNSHalphaRef.current = Boolean(user) && state.showNSNSHalpha;
    setNSNSHalphaOpacity(state.nsnsHalphaOpacity);
    nsnsHalphaOpacityRef.current = state.nsnsHalphaOpacity / 100;
    setNSNSHalphaBrightness(state.nsnsHalphaBrightness);
    nsnsHalphaBrightnessRef.current = state.nsnsHalphaBrightness;
    setNSNSHalphaColorized(state.nsnsHalphaColorized);
    nsnsHalphaColorizedRef.current = state.nsnsHalphaColorized;
    setShowEqGrid(state.showEqGrid);
    showEqGridRef.current = state.showEqGrid;
    setShowGalGrid(state.showGalGrid);
    showGalGridRef.current = state.showGalGrid;
    setShowCenterCrosshair(state.showCenterCrosshair);
    showCenterCrosshairRef.current = state.showCenterCrosshair;
    setShowCamSim(state.showCamSim);
    showCamSimRef.current = state.showCamSim;
    const activeEntries = restoredEntries.length > 0 ? restoredEntries : (state.showCamSim ? [createCamEntry()] : []);
    if (activeEntries.length > 0) {
      setCamEntries(activeEntries);
      camEntriesRef.current = activeEntries;
      if (restoredEntries.length === 0) setCameraEntries(activeEntries);
    }
    updateCenterCoord(true);
    invalidatePhotoLayer();
    requestDraw();
  }, [documentLoaded, user?.id]);

  useEffect(() => {
    if (!user || !documentLoaded || restoredUserRef.current !== user.id) return;
    const timer = setTimeout(() => {
      const state: SkyMapState = {
        centerRA: centerRA.current,
        centerDec: centerDec.current,
        fov: fov.current,
        showDeepSkyPhotos,
        showNSNS,
        nsnsOpacity,
        nsnsBrightness,
        nsnsColorized,
        showNSNSHalpha,
        nsnsHalphaOpacity,
        nsnsHalphaBrightness,
        nsnsHalphaColorized,
        showEqGrid,
        showGalGrid,
        showCenterCrosshair,
        showCamSim,
      };
      setMapState(state);
    }, 1500);
    return () => clearTimeout(timer);
  }, [
    centerCoordText, documentLoaded, nsnsBrightness, nsnsColorized, nsnsHalphaBrightness,
    nsnsHalphaColorized, nsnsHalphaOpacity, nsnsOpacity, showCamSim, showCenterCrosshair,
    showDeepSkyPhotos, showEqGrid, showGalGrid, showNSNS, showNSNSHalpha, user?.id, viewRevision,
  ]);

  /* ── load data ── */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
      const fetchJson = async <T,>(url: string): Promise<T> => {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`${url} returned ${res.status}`);
        return res.json() as Promise<T>;
      };

      const [starsData, hipData, metaData, pnRows, snrRows, dsoRows] = await Promise.all([
        fetchJson<(number[])[]>(`${SKYMAP_ASSET_URL}/stars.json`),
        fetchJson<Record<string, [number, number]>>(`${SKYMAP_ASSET_URL}/hip_map.json`),
        fetchJson<Overlay[]>(`${SKYMAP_ASSET_URL}/metadata.json`),
        fetchJson<PNRow[]>(`${SKYMAP_ASSET_URL}/pn_catalog.json`),
        fetchJson<SNRRow[]>(`${SKYMAP_ASSET_URL}/snr_catalog.json`),
        fetchJson<DSORow[]>(`${SKYMAP_ASSET_URL}/dso_catalog.json`),
      ]);
      if (cancelled) return;

      setLoadError(null);
      pnData.current = pnRows;
      snrData.current = snrRows;
      dsoData.current = dsoRows;

      stars.current = starsData.map((s) => ({
        ra: s[0], dec: s[1], mag: s[2], ci: s[3] ?? 0.62, hip: s[4],
      }));

      hipMap.current = hipData;

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

      // Sort: larger field area first (so smaller images render on top)
      metaData.sort((a, b) => (b.field_w_deg * b.field_h_deg) - (a.field_w_deg * a.field_h_deg));
      overlays.current = metaData;
      invalidatePhotoLayer();

      // Detail images are loaded on-demand when user clicks an overlay
      // Build search index
      buildSearchIndex(metaData, dsoData.current, pnData.current, snrData.current);
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : "Failed to load sky-map data");
        }
      }
    })();
    return () => { cancelled = true; };
  }, [requestDraw]);

  useEffect(() => {
    let cancelled = false;
    fetch(NSNS_ORDER6_COVERAGE_URL)
      .then((response) => {
        if (!response.ok) throw new Error(`${NSNS_ORDER6_COVERAGE_URL} returned ${response.status}`);
        return response.json() as Promise<number[]>;
      })
      .then((tiles) => {
        if (!cancelled) nsnsOrder6TilesRef.current = new Set(tiles);
      })
      .catch((error) => console.error("NSNS coverage index failed", error));
    return () => { cancelled = true; };
  }, []);

  /* ── NSNS OIII WebGL renderer; interaction remains owned by DSSM ── */
  useEffect(() => {
    if (!showNSNS || nsnsAladinRef.current || !nsnsHostRef.current) return;
    let cancelled = false;
    setNSNSStatus("loading");

    (async () => {
      const importModule = new Function("url", "return import(url)") as
        (url: string) => Promise<{ default?: NSNSAladinApi } & NSNSAladinApi>;
      const imported = await importModule(NSNS_MODULE_URL);
      const A = imported.default ?? imported;
      await A.init;
      if (cancelled || !nsnsHostRef.current) return;
      const aladin = A.aladin("#nsns-aladin-renderer", {
        target: `${centerRA.current} ${centerDec.current}`,
        fov: fov.current,
        survey: NSNS_HIPS_URL,
        projection: "STG",
        cooFrame: "ICRS",
        backgroundColor: "#000000",
        showCooGrid: false,
        showCooGridControl: false,
        showProjectionControl: false,
        showFullscreenControl: false,
        showLayersControl: false,
        showSimbadPointerControl: false,
        showContextMenu: false,
        showShareControl: false,
        reticleSize: 0,
      });
      const survey = aladin.createImageSurvey(
        "NSNS-DR0.2-OIII-8bit",
        "NSNS DR0.2 [OIII] nonlinear",
        NSNS_HIPS_URL,
        "equatorial",
        NSNS_MAX_ORDER,
        { imgFormat: "png" },
      );
      aladin.setBaseImageLayer(survey);
      nsnsAladinRef.current = aladin;
      nsnsRequestedViewRef.current = "";
      setNSNSStatus("ready");
      requestDraw();
    })().catch((error) => {
      console.error("NSNS OIII initialization failed", error);
      if (!cancelled) setNSNSStatus("error");
    });

    return () => { cancelled = true; };
  }, [hasFullResolution, showNSNS, requestDraw]);

  useEffect(() => {
    if (!showNSNSHalpha || nsnsHalphaAladinRef.current || !nsnsHalphaHostRef.current) return;
    let cancelled = false;
    setNSNSHalphaStatus("loading");

    (async () => {
      const importModule = new Function("url", "return import(url)") as
        (url: string) => Promise<{ default?: NSNSAladinApi } & NSNSAladinApi>;
      const imported = await importModule(NSNS_MODULE_URL);
      const A = imported.default ?? imported;
      await A.init;
      if (cancelled || !nsnsHalphaHostRef.current) return;
      const aladin = A.aladin("#nsns-halpha-aladin-renderer", {
        target: `${centerRA.current} ${centerDec.current}`,
        fov: fov.current,
        survey: NSNS_HALPHA_HIPS_URL,
        projection: "STG",
        cooFrame: "ICRS",
        backgroundColor: "#000000",
        showCooGrid: false,
        showCooGridControl: false,
        showProjectionControl: false,
        showFullscreenControl: false,
        showLayersControl: false,
        showSimbadPointerControl: false,
        showContextMenu: false,
        showShareControl: false,
        reticleSize: 0,
      });
      const survey = aladin.createImageSurvey(
        "NSNS-DR0.2-Halpha-8bit",
        "NSNS DR0.2 H-alpha nonlinear",
        NSNS_HALPHA_HIPS_URL,
        "equatorial",
        NSNS_MAX_ORDER,
        { imgFormat: "png" },
      );
      aladin.setBaseImageLayer(survey);
      nsnsHalphaAladinRef.current = aladin;
      nsnsHalphaRequestedViewRef.current = "";
      setNSNSHalphaStatus("ready");
      requestDraw();
    })().catch((error) => {
      console.error("NSNS H-alpha initialization failed", error);
      if (!cancelled) setNSNSHalphaStatus("error");
    });

    return () => { cancelled = true; };
  }, [hasFullResolution, showNSNSHalpha, requestDraw]);

  /* ── search index ── */
  const normalize = (s: string) => s.replace(/[\s\-_()]+/g, "").toLowerCase();

  const CAT_PREFIX_RX = /^(NGC|Sh\s*2|IC|MEL|M|C|B|G|PK)\s*-?\s*(\d+.*)$/i;
  const PAREN_RX = /\((\w+)\s+\d+\)/;

  function buildSearchIndex(metas: Overlay[], dso: DSORow[], pn: PNRow[], snr: SNRRow[]) {
    const names: SearchEntry[] = [];
    const rawCats: Record<string, CatEntry & { quality: number }> = {};
    const xrefQ: Record<string, number> = { NGC: 40, SH2: 30, MEL: 20, IC: 10 };

    const addName = (name: string, label: string, ra: number, dec: number, fov: number) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      names.push({ norm: normalize(trimmed), label, ra, dec, fov });
    };

    const addCatalogAliases = (name: string, label: string, ra: number, dec: number, fov: number, quality = 0) => {
      addName(name, label, ra, dec, fov);
      for (const alias of name.split(/[,;/]|\s+\(|\)\s*/)) addName(alias, label, ra, dec, fov);
      const idRx = /(NGC|Sh\s*2|IC|MEL|M|C|B|G|PK)\s*-?\s*(\d+(?:\.\d+)?(?:[+-]\d+(?:\.\d+)?)?)/gi;
      let match;
      while ((match = idRx.exec(name)) !== null) {
        const prefix = match[1].toUpperCase().replace(/\s/g, "");
        const num = match[2];
        const key = `${prefix}:${num}`;
        if (!rawCats[key] || quality > rawCats[key].quality) {
          rawCats[key] = { prefix, num, label, ra, dec, fov, quality };
        }
      }
    };

    // Overlays (photos)
    for (const m of metas) {
      const parts = m.name.split("_");
      const display = parts.length >= 4
        ? `${parts.slice(0, -3).join("_")} (${parts[parts.length - 1]})`
        : m.name;
      const fovH = Math.max(m.field_w_deg, m.field_h_deg) * 1.5;
      const label = `📷 ${display}`;
      addName(display, label, m.ra, m.dec, fovH);
      if (parts.length === 4) {
        addName(parts[0], label, m.ra, m.dec, fovH);
      }
      for (const objectName of m.objects ?? []) addName(objectName, label, m.ra, m.dec, fovH);
    }

    // DSO catalog
    for (const row of dso) {
      const [ra, dec, radDeg, , , nm] = row;
      if (!nm) continue;
      const fovD = Math.max(radDeg * 6, 1.0);
      const label = `⚪ ${nm}`;
      const pm = PAREN_RX.exec(nm);
      const xc = pm ? pm[1].toUpperCase() : "";
      const quality = xrefQ[xc] ?? 0;
      addCatalogAliases(nm, label, ra, dec, fovD, quality);
    }

    // Planetary nebulae and candidates shown on the canvas
    for (const [ra, dec, radDeg, , , name] of pn) {
      if (!name) continue;
      addCatalogAliases(name, `PN ${name}`, ra, dec, Math.max(radDeg * 8, 0.5));
    }

    // Supernova remnants shown on the canvas
    for (const [ra, dec, radDeg, name] of snr) {
      if (!name) continue;
      addCatalogAliases(name, `SNR ${name}`, ra, dec, Math.max(radDeg * 6, 1.0));
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

  function jumpTo(ra: number, dec: number, fovVal?: number) {
    centerRA.current = ra;
    centerDec.current = dec;
    if (fovVal !== undefined) fov.current = Math.min(fovVal, MAX_FOV);
    updateCenterCoord(true);
    requestDraw();
    setShowSearchDropdown(false);
  }

  function handleSearchSubmit() {
    if (searchResults.length > 0) {
      const r = searchResults[0];
      jumpTo(r.ra, r.dec, r.fov);
    }
  }

  /* ── camera entry management ── */
  function normalizeCamEntry(entry: CameraConfig): CamConfig {
    return {
      ...entry,
      id: entry.id || crypto.randomUUID(),
      name: entry.name || "",
      hidden: Boolean(entry.hidden),
      collapsed: Boolean(entry.collapsed),
    };
  }

  function createCamEntry(): CamConfig {
    return normalizeCamEntry({ focal: 500, sw: 36, sh: 24, angle: 0, mosX: 1, mosY: 1, overlap: 20 });
  }

  function commitCamEntries(next: CamConfig[]) {
    setCamEntries(next);
    camEntriesRef.current = next;
    if (user) setCameraEntries(next.map((entry) => ({ ...entry })));
    requestDraw();
  }

  function addCamEntry() {
    commitCamEntries([...camEntries, createCamEntry()]);
  }

  function removeCamEntry(idx: number) {
    const entry = camEntries[idx];
    if (!entry || !window.confirm("将删除视场与候选目标")) return;
    commitCamEntries(camEntries.filter((_, index) => index !== idx));
    for (const target of userDocument.cameraCandidateTargets) {
      if (target.cameraId === entry.id || (!target.cameraId && idx === 0)) deleteCameraCandidateTarget(target.id);
    }
  }

  function updateCamEntry(idx: number, field: "focal" | "sw" | "sh" | "angle" | "mosX" | "mosY" | "overlap", value: string) {
    const next = camEntries.map((c, i) => {
      if (i !== idx) return c;
      const v = parseFloat(value) || 0;
      const updated = { ...c, [field]: v };
      if (field === "mosX" || field === "mosY") updated[field] = Math.max(1, Math.round(v));
      return updated;
    });
    commitCamEntries(next);
  }

  function patchCamEntry(idx: number, patch: Partial<CamConfig>) {
    commitCamEntries(camEntries.map((entry, index) => index === idx ? { ...entry, ...patch } : entry));
  }

  function targetsForCamera(entry: CamConfig, index: number): CameraCandidateTarget[] {
    return userDocument.cameraCandidateTargets.filter((target) =>
      target.cameraId === entry.id || (!target.cameraId && index === 0)
    );
  }

  function recordCameraCandidate(entry: CamConfig, index: number) {
    if (!user || !entry.id) return;
    const groupTargets = targetsForCamera(entry, index);
    const candidateName = candidateNames[entry.id] || "";
    const fallback = `候选目标 ${groupTargets.length + 1}`;
    saveCameraCandidateTarget({
      id: crypto.randomUUID(),
      cameraId: entry.id,
      name: candidateName.trim() || searchQuery.trim() || fallback,
      ra: centerRA.current,
      dec: centerDec.current,
      fov: fov.current,
      entries: [{ ...entry, hidden: false, collapsed: false }],
      hidden: false,
      createdAt: new Date().toISOString(),
    });
    setCandidateNames((current) => ({ ...current, [entry.id!]: "" }));
    setCandidateGroupsCollapsed((current) => ({ ...current, [entry.id!]: false }));
  }

  function renameCameraCandidate(target: CameraCandidateTarget, name: string) {
    const trimmed = name.trim();
    if (!trimmed || trimmed === target.name) return;
    saveCameraCandidateTarget({ ...target, name: trimmed });
  }

  function setCameraTargetsHidden(entry: CamConfig, index: number, hidden: boolean) {
    for (const target of targetsForCamera(entry, index)) {
      saveCameraCandidateTarget({ ...target, hidden });
    }
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
    if (!nsnsAbovePhotosRef.current) drawNSNSTiles(ctx, sc, c, cx, cy, W, H);
    if (!nsnsHalphaAbovePhotosRef.current) drawNSNSHalphaTiles(ctx, sc, c, cx, cy, W, H);
    if (showDeepSkyPhotosRef.current) {
      // A hidden Aladin WebGL canvas is not a reliable source for later 2D
      // composition: after a static HiPS frame is presented its framebuffer
      // may already be empty. Keep the coordinate-constrained photo renderer
      // as the visible path so previews and selected detail never disappear.
      drawOverlays(ctx, sc, c, cx, cy, W, H);
    }
    if (nsnsAbovePhotosRef.current) drawNSNSTiles(ctx, sc, c, cx, cy, W, H);
    if (nsnsHalphaAbovePhotosRef.current) drawNSNSHalphaTiles(ctx, sc, c, cx, cy, W, H);
    drawRecordedCameraCandidates(ctx, sc, c, cx, cy, W, H);
    drawPN(ctx, sc, c, cx, cy, W, H, fov.current);
    drawSNR(ctx, sc, c, cx, cy, W, H, fov.current);
    drawDSO(ctx, sc, c, cx, cy, W, H, fov.current);
    drawCamFov(ctx, sc, cx, cy);

    // Crosshair
    if (showCenterCrosshairRef.current) {
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

  function drawNSNSTiles(
    ctx: CanvasRenderingContext2D, sc: number, c: ProjCenter,
    cx: number, cy: number, W: number, H: number
  ) {
    drawNSNSLayer(ctx, sc, c, cx, cy, W, H, showNSNSRef.current, nsnsAladinRef.current,
      nsnsHostRef.current, nsnsRequestedViewRef, nsnsOpacityRef.current, nsnsBrightnessRef.current,
      nsnsColorizedRef.current, NSNS_OIII_COLOR);
  }

  function drawNSNSHalphaTiles(
    ctx: CanvasRenderingContext2D, sc: number, c: ProjCenter,
    cx: number, cy: number, W: number, H: number
  ) {
    drawNSNSLayer(ctx, sc, c, cx, cy, W, H, showNSNSHalphaRef.current, nsnsHalphaAladinRef.current,
      nsnsHalphaHostRef.current, nsnsHalphaRequestedViewRef, nsnsHalphaOpacityRef.current, nsnsHalphaBrightnessRef.current,
      nsnsHalphaColorizedRef.current, NSNS_HALPHA_COLOR);
  }

  function drawNSNSLayer(
    ctx: CanvasRenderingContext2D, sc: number, c: ProjCenter,
    cx: number, cy: number, W: number, H: number, visible: boolean,
    aladin: NSNSAladin | null, host: HTMLDivElement | null,
    requestedViewRef: { current: string }, opacity: number, brightness: number,
    colorized: boolean, color: string, compositeOperation: GlobalCompositeOperation = "screen",
    freezeViewDuringDrag = false
  ) {
    if (!visible) return;
    if (!aladin || !host) return;
    const view = `${centerRA.current.toFixed(6)}:${centerDec.current.toFixed(6)}:${fov.current.toFixed(6)}`;
    if (view !== requestedViewRef.current && !(freezeViewDuringDrag && isDraggingView.current)) {
      requestedViewRef.current = view;
      aladin.gotoRaDec(centerRA.current, centerDec.current);
      aladin.setFoV(fov.current);
    }
    const imageCanvas = host.querySelector<HTMLCanvasElement>("canvas.aladin-imageCanvas");
    if (!imageCanvas || imageCanvas.width < 2 || imageCanvas.height < 2) return;

    // Keep Aladin's continuously rendered frame visible, then align its current
    // view to DSSM with a local three-point sky transform. This avoids flashing
    // while Aladin catches up during rapid drag/zoom.
    const [aladinRA, aladinDec] = aladin.getRaDec();
    const [aladinFov] = aladin.getFov();
    const aladinCenter = makeCenter(aladinRA, aladinDec);
    const aladinScale = computeScale(W, aladinFov);
    const anchorDistance = Math.max(32, Math.min(W, H) / 4);
    const sourceAnchors: [number, number][] = [
      [cx, cy],
      [cx + anchorDistance, cy],
      [cx, cy + anchorDistance],
    ];
    const destinationAnchors = sourceAnchors.map(([sx, sy]) => {
      const [ra, dec] = stereoInv((cx - sx) / aladinScale, (cy - sy) / aladinScale, aladinCenter);
      const [x, y] = stereoFwd(ra, dec, c);
      return [cx - x * sc, cy - y * sc] as [number, number];
    });
    const [origin, xAnchor, yAnchor] = destinationAnchors;
    const a = (xAnchor[0] - origin[0]) / anchorDistance;
    const b = (xAnchor[1] - origin[1]) / anchorDistance;
    const cc = (yAnchor[0] - origin[0]) / anchorDistance;
    const d = (yAnchor[1] - origin[1]) / anchorDistance;
    const e = origin[0] - a * cx - cc * cy;
    const ff = origin[1] - b * cx - d * cy;

    if (colorized) {
      const layerCtx = getLayerContext(W, H);
      if (!layerCtx) return;
      layerCtx.clearRect(0, 0, W, H);
      layerCtx.save();
      layerCtx.filter = `brightness(${brightness}%)`;
      layerCtx.transform(a, b, cc, d, e, ff);
      layerCtx.drawImage(imageCanvas, 0, 0, W, H);
      layerCtx.restore();
      layerCtx.save();
      layerCtx.globalCompositeOperation = "multiply";
      layerCtx.fillStyle = color;
      layerCtx.fillRect(0, 0, W, H);
      layerCtx.restore();
      layerCtx.save();
      layerCtx.globalCompositeOperation = "destination-in";
      layerCtx.transform(a, b, cc, d, e, ff);
      layerCtx.drawImage(imageCanvas, 0, 0, W, H);
      layerCtx.restore();

      ctx.save();
      ctx.globalCompositeOperation = compositeOperation;
      ctx.globalAlpha = opacity;
      ctx.drawImage(layerCtx.canvas, 0, 0);
      ctx.restore();
    } else {
      ctx.save();
      ctx.globalCompositeOperation = compositeOperation;
      ctx.globalAlpha = opacity;
      ctx.filter = `brightness(${brightness}%)`;
      ctx.transform(a, b, cc, d, e, ff);
      ctx.drawImage(imageCanvas, 0, 0, W, H);
      ctx.restore();
    }
  }

  function getLayerContext(W: number, H: number): CanvasRenderingContext2D | null {
    let canvas = layerCanvasRef.current;
    if (!canvas) {
      canvas = document.createElement("canvas");
      layerCanvasRef.current = canvas;
    }
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W;
      canvas.height = H;
    }
    return canvas.getContext("2d");
  }

  function isWithinNSNSCoverage(px: number, py: number, W: number, H: number): boolean {
    const tiles = nsnsOrder6TilesRef.current;
    if (!tiles || tiles.size === 0) return false;
    const sc = computeScale(W, fov.current);
    const c = makeCenter(centerRA.current, centerDec.current);
    const [ra, dec] = stereoInv((W / 2 - px) / sc, (H / 2 - py) / sc, c);
    return tiles.has(healpixNestAng2pix(6, ra, dec));
  }

  function toggleTopNSNSLayerAt(px: number, py: number, W: number, H: number): boolean {
    if (!isWithinNSNSCoverage(px, py, W, H)) return false;

    // Follow the actual draw order. When both layers are enabled, one click
    // changes only the visible topmost NSNS layer at that sky position.
    if (showNSNSHalphaRef.current && nsnsHalphaAbovePhotosRef.current) {
      nsnsHalphaAbovePhotosRef.current = false;
      return true;
    }
    if (showNSNSRef.current && nsnsAbovePhotosRef.current) {
      nsnsAbovePhotosRef.current = false;
      return true;
    }
    if (showNSNSHalphaRef.current) {
      nsnsHalphaAbovePhotosRef.current = true;
      return true;
    }
    if (showNSNSRef.current) {
      nsnsAbovePhotosRef.current = true;
      return true;
    }
    return false;
  }

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
  function drawRecordedCameraCandidates(
    ctx: CanvasRenderingContext2D, sc: number, c: ProjCenter,
    cx: number, cy: number, W: number, H: number
  ) {
    const dpr = window.devicePixelRatio || 1;
    for (const target of cameraCandidateTargetsRef.current) {
      if (target.hidden) continue;
      const [x, y, cc] = stereoFwd(target.ra, target.dec, c);
      if (cc < -0.2) continue;
      const tx = cx - x * sc;
      const ty = cy - y * sc;
      if (tx < -W || tx > W * 2 || ty < -H || ty > H * 2) continue;
      const targetCenter = makeCenter(target.ra, target.dec);

      let labelX = tx;
      let labelY = ty;
      for (const cfg of target.entries) {
        const { focal, sw, sh, angle, mosX, mosY, overlap } = cfg;
        if (focal <= 0 || sw <= 0 || sh <= 0) continue;
        const halfW = 2 * Math.tan(Math.atan(sw / (2 * focal)) / 2);
        const halfH = 2 * Math.tan(Math.atan(sh / (2 * focal)) / 2);
        const cosA = Math.cos(angle * Math.PI / 180);
        const sinA = Math.sin(angle * Math.PI / 180);
        const olap = Math.max(0, Math.min(99, overlap)) / 100;
        const stepW = halfW * 2 * (1 - olap);
        const stepH = halfH * 2 * (1 - olap);
        const totalHW = mosX > 1 ? halfW + stepW * (mosX - 1) / 2 : halfW;
        const totalHH = mosY > 1 ? halfH + stepH * (mosY - 1) / 2 : halfH;
        const rot = (px: number, py: number): [number, number] => [
          px * cosA - py * sinA, px * sinA + py * cosA,
        ];
        const projectFixedSkyPoint = (px: number, py: number): [number, number, number] => {
          const [rx, ry] = rot(px, py);
          // Candidate geometry is defined once in the target-centered tangent
          // plane, then reprojected into the current view on every frame.
          const [ra, dec] = stereoInv(-rx, -ry, targetCenter);
          const [viewX, viewY, viewCosC] = stereoFwd(ra, dec, c);
          return [cx - viewX * sc, cy - viewY * sc, viewCosC];
        };

        ctx.strokeStyle = "rgba(255,190,70,0.78)";
        ctx.lineWidth = 1.2 * dpr;
        ctx.setLineDash([4 * dpr, 3 * dpr]);
        for (let ix = 0; ix < mosX; ix++) {
          for (let iy = 0; iy < mosY; iy++) {
            const pcx = mosX > 1 ? stepW * (ix - (mosX - 1) / 2) : 0;
            const pcy = mosY > 1 ? stepH * (iy - (mosY - 1) / 2) : 0;
            const corners: [number, number][] = [
              [pcx - halfW, pcy - halfH], [pcx + halfW, pcy - halfH],
              [pcx + halfW, pcy + halfH], [pcx - halfW, pcy + halfH],
            ];
            const projected = corners.map(([cornerX, cornerY]) => projectFixedSkyPoint(cornerX, cornerY));
            if (projected.some(([, , cornerCosC]) => cornerCosC < -0.2)) continue;
            ctx.beginPath();
            for (let index = 0; index < projected.length; index++) {
              const [screenX, screenY] = projected[index];
              if (index === 0) ctx.moveTo(screenX, screenY);
              else ctx.lineTo(screenX, screenY);
            }
            ctx.closePath();
            ctx.stroke();
          }
        }
        const [topRightX, topRightY, topRightCosC] = projectFixedSkyPoint(totalHW, -totalHH);
        if (topRightCosC >= -0.2) {
          labelX = topRightX;
          labelY = topRightY;
        }
      }
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(255,210,120,0.94)";
      ctx.font = `${11 * dpr}px sans-serif`;
      ctx.fillText(target.name, labelX + 5 * dpr, labelY - 18 * dpr);
      ctx.fillStyle = "rgba(255,210,120,0.68)";
      ctx.font = `${10 * dpr}px monospace`;
      ctx.fillText(`${formatRaHms(target.ra)}  ${formatDms(target.dec)}`, labelX + 5 * dpr, labelY - 5 * dpr);
    }
  }

  function drawCamFov(
    ctx: CanvasRenderingContext2D, sc: number, cx: number, cy: number
  ) {
    if (!showCamSimRef.current) return;
    const cfgs = camEntriesRef.current;
    if (cfgs.length === 0) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.font = `${11 * dpr}px sans-serif`;

    for (const cfg of cfgs) {
      if (cfg.hidden) continue;
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
      const [cr, cg, cb] = bvToRgb(st.ci);
      ctx.fillStyle = `rgba(${cr},${cg},${cb},${(a / 255).toFixed(2)})`;
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
    const nsnsActive = showNSNSRef.current || showNSNSHalphaRef.current;
    const lineW = Math.max(0.4, Math.min(2.2, 30 / fovDeg)) * (nsnsActive ? 2 : 1);
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
          ctx.font = `${nsnsActive ? "bold " : ""}${14 * dpr}px sans-serif`;
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
    const nsnsActive = showNSNSRef.current || showNSNSHalphaRef.current;
    const lineW = Math.max(0.4, Math.min(2.2, 30 / fovDeg)) * (nsnsActive ? 2 : 1);
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
          ctx.font = `${nsnsActive ? "bold " : ""}${14 * dpr}px sans-serif`;
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

    const nsnsActive = showNSNSRef.current || showNSNSHalphaRef.current;
    const lineW = Math.max(0.4, Math.min(2.2, 30 / fovDeg)) * (nsnsActive ? 2 : 1);
    const alpha = Math.max(100, Math.min(220, Math.round(500 / fovDeg)));
    const a = (alpha / 255).toFixed(2);
    const showAll = fovDeg < 5;
    const showBig = fovDeg < 30;
    ctx.lineWidth = lineW;
    ctx.setLineDash([4, 3]);
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
      ctx.strokeStyle = `rgba(${DSO_COLOR[0]},${DSO_COLOR[1]},${DSO_COLOR[2]},${a})`;
      ctx.beginPath();
      ctx.arc(sx, sy, rPx, 0, Math.PI * 2);
      ctx.stroke();

      if (showAll || (showBig && rPx > 10)) {
        if (label) {
          ctx.font = `${nsnsActive ? "bold " : ""}${14 * dpr}px sans-serif`;
          const tw = ctx.measureText(label).width;
          const th = 14 * dpr;
          const [tx, ty] = placeLabel(sx, sy, rPx, tw, th, labelRects);
          ctx.fillStyle = `rgba(${DSO_COLOR[0]},${DSO_COLOR[1]},${DSO_COLOR[2]},${a})`;
          ctx.fillText(label, tx, ty);
          labelRects.push([tx, ty - th, tx + tw, ty]);
        }
      }
    }
    ctx.setLineDash([]);
  }

  /* ── overlays ── */
  function getPhotoGLRenderer(W: number, H: number): PhotoGLRenderer | null {
    let renderer = photoGLRendererRef.current;
    if (!renderer) {
      const canvas = document.createElement("canvas");
      const gl = canvas.getContext("webgl", {
        alpha: true,
        antialias: true,
        premultipliedAlpha: true,
      });
      if (!gl) return null;

      const compileShader = (type: number, source: string) => {
        const shader = gl.createShader(type);
        if (!shader) return null;
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
          console.error("Deep-sky photo shader failed", gl.getShaderInfoLog(shader));
          gl.deleteShader(shader);
          return null;
        }
        return shader;
      };
      const vertexShader = compileShader(gl.VERTEX_SHADER, `
        attribute vec2 a_position;
        attribute vec2 a_texCoord;
        uniform vec2 u_resolution;
        uniform mat3 u_homography;
        varying vec2 v_texCoord;
        void main() {
          vec3 mapped = u_homography * vec3(a_position, 1.0);
          vec2 screen = mapped.xy / mapped.z;
          vec2 clip = (screen / u_resolution) * 2.0 - 1.0;
          gl_Position = vec4(clip.x * mapped.z, -clip.y * mapped.z, 0.0, mapped.z);
          v_texCoord = a_texCoord;
        }
      `);
      const fragmentShader = compileShader(gl.FRAGMENT_SHADER, `
        precision mediump float;
        uniform sampler2D u_image;
        uniform float u_opacity;
        varying vec2 v_texCoord;
        void main() {
          vec4 color = texture2D(u_image, v_texCoord);
          gl_FragColor = vec4(color.rgb, color.a * u_opacity);
        }
      `);
      if (!vertexShader || !fragmentShader) return null;

      const program = gl.createProgram();
      const positionBuffer = gl.createBuffer();
      const texCoordBuffer = gl.createBuffer();
      if (!program || !positionBuffer || !texCoordBuffer) return null;
      gl.attachShader(program, vertexShader);
      gl.attachShader(program, fragmentShader);
      gl.linkProgram(program);
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.error("Deep-sky photo WebGL program failed", gl.getProgramInfoLog(program));
        return null;
      }

      const positionLocation = gl.getAttribLocation(program, "a_position");
      const texCoordLocation = gl.getAttribLocation(program, "a_texCoord");
      const resolutionLocation = gl.getUniformLocation(program, "u_resolution");
      const homographyLocation = gl.getUniformLocation(program, "u_homography");
      const opacityLocation = gl.getUniformLocation(program, "u_opacity");
      if (positionLocation < 0 || texCoordLocation < 0 || !resolutionLocation || !homographyLocation || !opacityLocation) return null;

      renderer = {
        canvas,
        gl,
        program,
        positionBuffer,
        texCoordBuffer,
        positionLocation,
        texCoordLocation,
        resolutionLocation,
        homographyLocation,
        opacityLocation,
        textures: new Map(),
        frame: 0,
      };
      photoGLRendererRef.current = renderer;

      gl.useProgram(program);
      const imageLocation = gl.getUniformLocation(program, "u_image");
      if (imageLocation) gl.uniform1i(imageLocation, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        0, 0, 1, 0, 0, 1,
        1, 0, 1, 1, 0, 1,
      ]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(texCoordLocation);
      gl.vertexAttribPointer(texCoordLocation, 2, gl.FLOAT, false, 0, 0);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    }

    if (renderer.canvas.width !== W || renderer.canvas.height !== H) {
      renderer.canvas.width = W;
      renderer.canvas.height = H;
    }
    renderer.gl.viewport(0, 0, W, H);
    return renderer;
  }

  function getPhotoTexture(renderer: PhotoGLRenderer, img: HTMLImageElement): WebGLTexture | null {
    const cached = renderer.textures.get(img);
    if (cached) {
      cached.lastUsedFrame = renderer.frame;
      return cached.texture;
    }
    const { gl } = renderer;
    const texture = gl.createTexture();
    if (!texture) return null;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    // Texture coordinates use the same top-left origin/order as Qt's source quad:
    // TL, TR, BR, BL. Flipping here mirrors every photo inside its correct sky quad.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    let source: TexImageSource = img;
    if (img.naturalWidth > maxTextureSize || img.naturalHeight > maxTextureSize) {
      const scale = Math.min(maxTextureSize / img.naturalWidth, maxTextureSize / img.naturalHeight);
      const resized = document.createElement("canvas");
      resized.width = Math.max(1, Math.floor(img.naturalWidth * scale));
      resized.height = Math.max(1, Math.floor(img.naturalHeight * scale));
      resized.getContext("2d")?.drawImage(img, 0, 0, resized.width, resized.height);
      source = resized;
    }
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    renderer.textures.set(img, { texture, lastUsedFrame: renderer.frame });
    return texture;
  }

  function squareToQuadHomography(points: [number, number][]): Float32Array | null {
    const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = points;
    const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
    const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
    const denominator = dx1 * dy2 - dx2 * dy1;
    let h31 = 0;
    let h32 = 0;
    if (Math.abs(dx3) > 1e-8 || Math.abs(dy3) > 1e-8) {
      if (Math.abs(denominator) < 1e-8) return null;
      h31 = (dx3 * dy2 - dx2 * dy3) / denominator;
      h32 = (dx1 * dy3 - dx3 * dy1) / denominator;
    }
    const h11 = x1 - x0 + h31 * x1;
    const h12 = x3 - x0 + h32 * x3;
    const h21 = y1 - y0 + h31 * y1;
    const h22 = y3 - y0 + h32 * y3;
    return new Float32Array([
      h11, h21, h31,
      h12, h22, h32,
      x0, y0, 1,
    ]);
  }

  function choosePhotoLod(screenPoints: [number, number][]): number {
    const xs = screenPoints.map((point) => point[0]);
    const ys = screenPoints.map((point) => point[1]);
    const required = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * 1.25;
    const selected = PHOTO_LOD_LEVELS.find((level) => level >= required) ?? PHOTO_LOD_LEVELS[PHOTO_LOD_LEVELS.length - 1];
    return hasFullResolutionRef.current ? selected : Math.min(selected, GUEST_PHOTO_MAX_LOD);
  }

  function requestPhotoPreview(ov: Overlay, lod: number) {
    if (ov.pendingLod === lod || (ov.img && ov.imgLod === lod) || ov.previewFailed) return;
    ov.pendingLod = lod;

    const pumpQueue = () => {
      while (activePhotoLoadsRef.current < 6 && photoLoadQueueRef.current.length > 0) {
        const next = photoLoadQueueRef.current.shift();
        next?.();
      }
    };
    photoLoadQueueRef.current.push(() => {
      if (ov.pendingLod !== lod) {
        pumpQueue();
        return;
      }
      activePhotoLoadsRef.current += 1;
      const img = new Image();
      img.crossOrigin = "anonymous";
      ov.pendingImg = img;
      const finish = () => {
        activePhotoLoadsRef.current -= 1;
        pumpQueue();
      };
      img.onload = () => {
        if (ov.pendingImg === img && ov.pendingLod === lod) {
          ov.img = img;
          ov.imgLod = lod;
          ov.pendingImg = undefined;
          ov.pendingLod = undefined;
          invalidatePhotoLayer();
        }
        finish();
      };
      img.onerror = () => {
        if (ov.pendingImg === img && ov.pendingLod === lod) {
          ov.pendingImg = undefined;
          ov.pendingLod = undefined;
          ov.previewFailed = true;
          invalidatePhotoLayer();
        }
        finish();
      };
      img.src = `${SKYMAP_ASSET_URL}/photo_lod/${lod}/${encodeURIComponent(ov.name)}.webp`;
    });
    pumpQueue();
  }

  function drawOverlays(
    ctx: CanvasRenderingContext2D, sc: number, c: ProjCenter,
    cx: number, cy: number, W: number, H: number
  ) {
    const detailOverlay = overlays.current.find((overlay) => overlay.showDetail);
    const detailKey = detailOverlay
      ? `${detailOverlay.name}:${detailOverlay.detailImg?.complete ? 1 : 0}`
      : "";
    const cacheKey = [
      centerRA.current.toFixed(6), centerDec.current.toFixed(6), fov.current.toFixed(6),
      W, H, photoLayerVersionRef.current, detailKey,
    ].join(":");
    const cachedLayer = photoLayerCacheRef.current;
    if (
      cachedLayer && photoLayerCacheKeyRef.current === cacheKey &&
      cachedLayer.width === W && cachedLayer.height === H
    ) {
      ctx.drawImage(cachedLayer, 0, 0);
      return;
    }

    const renderer = getPhotoGLRenderer(W, H);
    if (!renderer) {
      drawOverlaysCanvas(ctx, sc, c, cx, cy, W, H);
      return;
    }

    const { gl } = renderer;
    renderer.frame += 1;
    gl.useProgram(renderer.program);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(renderer.resolutionLocation, W, H);

    const ovs = overlays.current;
    let detailOv: Overlay | null = null;
    for (let i = 0; i < ovs.length; i++) {
      const ov = ovs[i];
      if (ov.showDetail) { detailOv = ov; continue; }
      drawSingleOverlayGL(renderer, ov, sc, c, cx, cy, W, H, false);
    }
    if (detailOv) {
      drawSingleOverlayGL(renderer, detailOv, sc, c, cx, cy, W, H, true);
    }

    // During drag the view changes every frame, so copying the full WebGL
    // result into a cache that cannot be reused only adds another screen-sized
    // blit. Composite it directly and rebuild the static cache after release.
    if (isDraggingView.current) {
      ctx.drawImage(renderer.canvas, 0, 0);
      return;
    }

    let cache = photoLayerCacheRef.current;
    if (!cache) {
      cache = document.createElement("canvas");
      photoLayerCacheRef.current = cache;
    }
    if (cache.width !== W || cache.height !== H) {
      cache.width = W;
      cache.height = H;
    }
    const cacheCtx = cache.getContext("2d");
    if (cacheCtx) {
      cacheCtx.clearRect(0, 0, W, H);
      cacheCtx.drawImage(renderer.canvas, 0, 0);
      photoLayerCacheKeyRef.current = cacheKey;
      ctx.drawImage(cache, 0, 0);
    } else {
      ctx.drawImage(renderer.canvas, 0, 0);
    }

    if (renderer.frame % 4 === 0) {
      const staleBefore = renderer.frame - 6;
      for (const [image, cached] of renderer.textures) {
        if (cached.lastUsedFrame < staleBefore) {
          gl.deleteTexture(cached.texture);
          renderer.textures.delete(image);
        }
      }
      for (const overlay of ovs) {
        if (!overlay.showDetail && (overlay.lastVisibleFrame ?? 0) < staleBefore) {
          overlay.img = undefined;
          overlay.imgLod = undefined;
          overlay.pendingImg = undefined;
          overlay.pendingLod = undefined;
        }
      }
    }
  }

  function drawSingleOverlayGL(
    renderer: PhotoGLRenderer, ov: Overlay,
    sc: number, c: ProjCenter, cx: number, cy: number,
    W: number, H: number,
    isDetail: boolean
  ) {
    const corners = ov.corners;
    if (!corners || corners.length !== 4) return;

    const screenPts: [number, number][] = [];
    for (let j = 0; j < 4; j++) {
      const [x, y, cc] = stereoFwd(corners[j][0], corners[j][1], c);
      if (cc < -0.3) return;
      screenPts.push([cx - x * sc, cy - y * sc]);
    }
    const xs = screenPts.map((point) => point[0]);
    const ys = screenPts.map((point) => point[1]);
    if (Math.max(...xs) < 0 || Math.min(...xs) > W || Math.max(...ys) < 0 || Math.min(...ys) > H) return;
    ov.lastVisibleFrame = renderer.frame;

    requestPhotoPreview(ov, choosePhotoLod(screenPts));
    const activeImg = (ov.showDetail && ov.detailImg?.complete && ov.detailImg.naturalWidth > 0)
      ? ov.detailImg : ov.img;
    if (!activeImg || !activeImg.complete || activeImg.naturalWidth === 0) return;

    const texture = getPhotoTexture(renderer, activeImg);
    if (!texture) return;
    const { gl } = renderer;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    const homography = squareToQuadHomography(screenPts);
    if (!homography) return;
    gl.uniformMatrix3fv(renderer.homographyLocation, false, homography);
    gl.bindBuffer(gl.ARRAY_BUFFER, renderer.positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      0, 0, 1, 0, 0, 1,
      1, 0, 1, 1, 0, 1,
    ]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(renderer.positionLocation);
    gl.vertexAttribPointer(renderer.positionLocation, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, renderer.texCoordBuffer);
    gl.enableVertexAttribArray(renderer.texCoordLocation);
    gl.vertexAttribPointer(renderer.texCoordLocation, 2, gl.FLOAT, false, 0, 0);
    gl.uniform1f(renderer.opacityLocation, isDetail ? 1 : 0.85);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  function drawOverlaysCanvas(
    ctx: CanvasRenderingContext2D, sc: number, c: ProjCenter,
    cx: number, cy: number, W: number, H: number
  ) {
    const ovs = overlays.current;
    let detailOv: Overlay | null = null;
    for (let i = 0; i < ovs.length; i++) {
      const ov = ovs[i];
      if (ov.showDetail) { detailOv = ov; continue; }
      drawSingleOverlayCanvas(ctx, ov, sc, c, cx, cy, W, H, false);
    }
    if (detailOv) drawSingleOverlayCanvas(ctx, detailOv, sc, c, cx, cy, W, H, true);
  }

  function drawSingleOverlayCanvas(
    ctx: CanvasRenderingContext2D, ov: Overlay,
    sc: number, c: ProjCenter, cx: number, cy: number,
    W: number, H: number,
    isDetail: boolean
  ) {
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

    const xs = screenPts.map((point) => point[0]);
    const ys = screenPts.map((point) => point[1]);
    if (Math.max(...xs) < 0 || Math.min(...xs) > W || Math.max(...ys) < 0 || Math.min(...ys) > H) return;

    requestPhotoPreview(ov, choosePhotoLod(screenPts));

    const activeImg = (ov.showDetail && ov.detailImg?.complete && ov.detailImg.naturalWidth > 0)
      ? ov.detailImg : ov.img;
    if (!activeImg || !activeImg.complete || activeImg.naturalWidth === 0) return;

    const iw = activeImg.naturalWidth;
    const ih = activeImg.naturalHeight;

    const layerCtx = getLayerContext(W, H);
    if (!layerCtx) return;
    layerCtx.clearRect(0, 0, W, H);
    drawTexturedQuad(layerCtx, activeImg, iw, ih, screenPts);
    ctx.save();
    ctx.globalAlpha = isDetail ? 1.0 : 0.85;
    ctx.drawImage(layerCtx.canvas, 0, 0);
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
    // Canvas anti-aliases every clipped triangle independently. Expanding the
    // clip by one device pixel hides hairline gaps between adjacent mesh cells.
    const centerX = (dx0 + dx1 + dx2) / 3;
    const centerY = (dy0 + dy1 + dy2) / 3;
    const expand = (x: number, y: number): [number, number] => {
      const vx = x - centerX;
      const vy = y - centerY;
      const length = Math.hypot(vx, vy);
      return length > 0 ? [x + vx / length, y + vy / length] : [x, y];
    };
    const p0 = expand(dx0, dy0);
    const p1 = expand(dx1, dy1);
    const p2 = expand(dx2, dy2);
    ctx.beginPath();
    ctx.moveTo(p0[0], p0[1]);
    ctx.lineTo(p1[0], p1[1]);
    ctx.lineTo(p2[0], p2[1]);
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
    requestDraw();
  }, [requestDraw]);

  /* ── wheel handler (native, non-passive) ── */
  const wheelHandler = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 0.8 : 1.25;
    fov.current = Math.max(MIN_FOV, Math.min(MAX_FOV, fov.current * factor));
    setViewRevision((value) => value + 1);
    requestDraw();
  }, [requestDraw]);

  /* ── animation loop ── */
  useEffect(() => {
    handleResize();
    window.addEventListener("resize", handleResize);

    // Use ResizeObserver to detect container size changes (e.g. sidebar layout)
    const container = containerRef.current;
    let ro: ResizeObserver | null = null;
    if (container) {
      ro = new ResizeObserver(() => handleResize());
      ro.observe(container);
    }

    const canvas = canvasRef.current;
    canvas?.addEventListener("wheel", wheelHandler, { passive: false });

    let lastNSNSDraw = 0;
    const loop = (time: number) => {
      if ((showNSNSRef.current || showNSNSHalphaRef.current) && time - lastNSNSDraw >= 50) {
        needsDraw.current = true;
        lastNSNSDraw = time;
      }
      if (needsDraw.current) {
        draw();
        needsDraw.current = false;
      }
      animId.current = requestAnimationFrame(loop);
    };
    animId.current = requestAnimationFrame(loop);

    return () => {
      window.removeEventListener("resize", handleResize);
      ro?.disconnect();
      canvas?.removeEventListener("wheel", wheelHandler);
      cancelAnimationFrame(animId.current);
      if (pointerUiFrame.current !== null) cancelAnimationFrame(pointerUiFrame.current);
      if (centerCoordFrame.current !== null) cancelAnimationFrame(centerCoordFrame.current);
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
    if (e.button !== 0) return;
    const pos = getCanvasPos(e.clientX, e.clientY);
    pressPos.current = pos;
    dragLast.current = pos;
    dragStartView.current = { ra: centerRA.current, dec: centerDec.current };
    activePointerId.current = e.pointerId;
    isDraggingView.current = false;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const pos = getCanvasPos(e.clientX, e.clientY);
    const isDragging = Boolean(
      activePointerId.current === e.pointerId &&
      pressPos.current &&
      dragStartView.current &&
      (e.buttons & 1) !== 0
    );

    if (isDragging && pressPos.current && dragStartView.current) {
      isDraggingView.current = true;
      const dx = pos.x - pressPos.current.x;
      const dy = pos.y - pressPos.current.y;
      const fovPerPx = fov.current / canvas.width;
      const cosDec = Math.cos((dragStartView.current.dec * Math.PI) / 180);
      centerRA.current = ((dragStartView.current.ra + dx * fovPerPx / Math.max(cosDec, 0.05)) % 360 + 360) % 360;
      centerDec.current = Math.max(-90, Math.min(90, dragStartView.current.dec + dy * fovPerPx));
      dragLast.current = pos;
      updateCenterCoord();
      requestDraw();
      if (lastHoverOverlay.current !== null) {
        lastHoverOverlay.current = null;
        setHoverOverlay(null);
      }
      return;
    }

    // Update coordinate display
    const W = canvas.width;
    const H = canvas.height;
    const sc = computeScale(W, fov.current);
    const c = makeCenter(centerRA.current, centerDec.current);
    const projX = (W / 2 - pos.x) / sc;
    const projY = (H / 2 - pos.y) / sc;
    const [raDeg, decDeg] = stereoInv(projX, projY, c);
    const nextCoordText = formatCoordinateText(raDeg, decDeg);

    // Hover detection
    const hit = !isDragging && showDeepSkyPhotosRef.current
      ? hitTestOverlay(pos.x, pos.y, sc, c, W / 2, H / 2)
      : null;
    queuePointerUi(nextCoordText, hit);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (activePointerId.current !== e.pointerId) return;
    const pos = getCanvasPos(e.clientX, e.clientY);
    const wasDragging = isDraggingView.current;
    isDraggingView.current = false;
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
          const hit = showDeepSkyPhotosRef.current
            ? hitTestOverlay(pos.x, pos.y, sc, c, W / 2, H / 2)
            : null;
          if (hit && hasFullResolutionRef.current) {
            if (hit.showDetail) {
              // Already showing detail → switch back to preview
              hit.showDetail = false;
              setSelectedOverlay(null);
              setDetailLoading(null);
            } else {
              // Clear any other detail first
              for (const ov of overlays.current) ov.showDetail = false;
              hit.showDetail = true;
              setSelectedOverlay({ ...hit });
              // Check if detail already loaded
              if (hit.detailImg?.complete && hit.detailImg.naturalWidth > 0) {
                setDetailLoading(null);
              } else {
                setDetailLoading(hit.name);
                if (!hit.detailImg) {
                  const img = new Image();
                  img.crossOrigin = "anonymous";
                  img.onload = () => {
                    setDetailLoading(null);
                    requestDraw();
                  };
                  img.onerror = () => {
                    hit.detailFailed = true;
                    hit.showDetail = false;
                    setSelectedOverlay({ ...hit });
                    setDetailLoading(null);
                    requestDraw();
                  };
                  img.src = `${SKYMAP_ASSET_URL}/details/${encodeURIComponent(hit.name)}.webp`;
                  hit.detailImg = img;
                } else {
                  // Already started loading, attach handler
                  hit.detailImg.onload = () => {
                    setDetailLoading(null);
                    requestDraw();
                  };
                  hit.detailImg.onerror = () => {
                    hit.detailFailed = true;
                    hit.showDetail = false;
                    setSelectedOverlay({ ...hit });
                    setDetailLoading(null);
                    requestDraw();
                  };
                }
              }
            }
          } else {
            // Empty NSNS-covered sky toggles the topmost active NSNS layer.
            // Clicking outside both photos and NSNS coverage keeps the desktop
            // behavior of clearing the selected detail image.
            if (!toggleTopNSNSLayerAt(pos.x, pos.y, W, H)) {
              for (const ov of overlays.current) ov.showDetail = false;
              setSelectedOverlay(null);
              setDetailLoading(null);
            }
          }
          requestDraw();
        }
      }
    }
    pressPos.current = null;
    dragLast.current = null;
    dragStartView.current = null;
    activePointerId.current = null;
    if ((e.target as HTMLElement).hasPointerCapture(e.pointerId)) {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    }
    if (wasDragging) {
      updateCenterCoord(true);
      requestDraw();
    }
  };

  const cancelPointerDrag = (e: React.PointerEvent) => {
    if (activePointerId.current !== e.pointerId) return;
    activePointerId.current = null;
    pressPos.current = null;
    dragLast.current = null;
    dragStartView.current = null;
    isDraggingView.current = false;
    updateCenterCoord(true);
    requestDraw();
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
        setViewRevision((value) => value + 1);
        requestDraw();
      }
      lastPinchDist.current = dist;
    }
  };

  return (
    <div className="flex flex-row h-full w-full">
      {/* ── Left sidebar ── */}
      <div className="w-[380px] shrink-0 bg-[#111118] border-r border-white/5 flex flex-col overflow-y-auto text-[13px] text-white/50">
        {/* Coord display */}
        <div className="px-3 py-2 border-b border-white/5 font-mono text-[12px] leading-relaxed text-white/50">
          <div>
            <div className="font-sans text-[11px] leading-4 text-white/35">鼠标位置</div>
            <div className="mt-0.5 whitespace-nowrap">
              <span className="font-sans text-white/40">赤道</span>
              <span className="ml-2">{coordText.ra}</span>
              <span className="ml-3">{coordText.dec}</span>
            </div>
            <div className="whitespace-nowrap">
              <span className="font-sans text-white/40">银道</span>
              <span className="ml-2">{coordText.l}</span>
              <span className="ml-3">{coordText.b}</span>
            </div>
          </div>
          <div className="mt-2 border-t border-white/5 pt-2">
            <div className="flex items-center justify-between gap-2 font-sans text-[11px] leading-4 text-white/35">
              <span>屏幕中心（当前视野中央坐标）</span>
              <label className="flex items-center gap-1 text-white/50 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={showCenterCrosshair}
                  onChange={(e) => {
                    const next = e.target.checked;
                    setShowCenterCrosshair(next);
                    showCenterCrosshairRef.current = next;
                    requestDraw();
                  }}
                  className="h-3 w-3 accent-red-400"
                />
                十字线
              </label>
            </div>
            <div className="mt-0.5 whitespace-nowrap">
              <span className="font-sans text-white/40">赤道</span>
              <span className="ml-2">{centerCoordText.ra}</span>
              <span className="ml-3">{centerCoordText.dec}</span>
            </div>
            <div className="whitespace-nowrap">
              <span className="font-sans text-white/40">银道</span>
              <span className="ml-2">{centerCoordText.l}</span>
              <span className="ml-3">{centerCoordText.b}</span>
            </div>
          </div>
          <div className="mt-2 border-t border-white/5 pt-1.5 font-sans text-[11px] text-white/35">
            {user
              ? `云同步：${syncStatus === "saving" ? "保存中…" : syncStatus === "error" ? "失败" : "已连接"}`
              : "预览模式：深空照片提供粗预览；登录后可用高清与 OIII / H-alpha"}
          </div>
        </div>

        {/* Catalog toggles */}
        <div className="px-3 py-2 border-b border-white/5">
          <div className="text-white/40 text-[13px] mb-1">天体目录</div>
          <div className="flex flex-wrap gap-1">
            <ToggleBtn label="PN" on={showPN} bg="linear-gradient(90deg,rgba(255,60,60,.7),rgba(255,160,40,.7),rgba(0,200,100,.7))" color="#fff"
              onClick={() => { const v = !showPN; setShowPN(v); showPNRef.current = v; requestDraw(); }} />
            <ToggleBtn label="SNR" on={showSNR} bg="rgba(60,160,255,.7)" color="#fff"
              onClick={() => { const v = !showSNR; setShowSNR(v); showSNRRef.current = v; requestDraw(); }} />
            <ToggleBtn label="Messier" on={showMessier} bg="rgba(199,125,255,.75)" color="#160d20"
              onClick={() => { const v = !showMessier; setShowMessier(v); showMessierRef.current = v; requestDraw(); }} />
            <ToggleBtn label="NGC" on={showNGC} bg="rgba(199,125,255,.75)" color="#160d20"
              onClick={() => { const v = !showNGC; setShowNGC(v); showNGCRef.current = v; requestDraw(); }} />
            <ToggleBtn label="IC" on={showIC} bg="rgba(199,125,255,.75)" color="#160d20"
              onClick={() => { const v = !showIC; setShowIC(v); showICRef.current = v; requestDraw(); }} />
            <ToggleBtn label="Sh2" on={showSh2} bg="rgba(199,125,255,.75)" color="#160d20"
              onClick={() => { const v = !showSh2; setShowSh2(v); showSh2Ref.current = v; requestDraw(); }} />
          </div>
        </div>

        {/* Deep-sky photo layer */}
        <div className="px-3 py-2 border-b border-white/5">
          <div className="flex items-center justify-between gap-2">
            <div className="text-white/40 text-[13px]">深空曝光照片图层</div>
            <ToggleBtn label="深空照片" on={showDeepSkyPhotos} bg="rgba(130,105,220,.75)" color="#fff"
              onClick={() => {
                const value = !showDeepSkyPhotos;
                setShowDeepSkyPhotos(value);
                showDeepSkyPhotosRef.current = value;
                if (!value) {
                  for (const overlay of overlays.current) overlay.showDetail = false;
                  lastHoverOverlay.current = null;
                  setHoverOverlay(null);
                  setSelectedOverlay(null);
                  setDetailLoading(null);
                }
                requestDraw();
              }} />
          </div>
        </div>

        {/* NSNS OIII layer */}
        <div className="px-3 py-1.5 border-b border-white/5">
          <div className="flex items-center gap-1">
            <div className="mr-auto text-white/40 text-[13px]">NSNS OIII</div>
            <ToggleBtn label="显示" on={showNSNS} bg="rgba(90,180,220,.75)" color="#fff"
              disabled={!user}
              onClick={() => {
                if (!user) return;
                const value = !showNSNS;
                setShowNSNS(value);
                showNSNSRef.current = value;
                requestDraw();
              }} />
            <span className="h-3 w-3 shrink-0 rounded-sm border border-white/20" style={{ backgroundColor: NSNS_OIII_COLOR }} />
            <ToggleBtn label="着色" on={nsnsColorized} bg="rgba(50,200,255,.75)" color="#071018"
              onClick={() => {
                const value = !nsnsColorized;
                setNSNSColorized(value);
                nsnsColorizedRef.current = value;
                requestDraw();
              }} />
            <button
              type="button"
              aria-expanded={nsnsControlsExpanded}
              onClick={() => setNSNSControlsExpanded((value) => !value)}
              className="rounded px-1.5 py-1 text-[12px] text-white/45 transition-colors hover:bg-white/5 hover:text-white/70"
            >
              调整 {nsnsControlsExpanded ? "▴" : "▾"}
            </button>
          </div>
          {nsnsControlsExpanded && (
            <div className="mt-1.5 border-t border-white/5 pt-1.5">
              <div className="flex items-center gap-2">
                <span className="w-12 shrink-0 text-[12px] text-white/40">透明度</span>
                <input type="range" min="0" max="100" value={nsnsOpacity} disabled={!showNSNS}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    setNSNSOpacity(value);
                    nsnsOpacityRef.current = value / 100;
                    requestDraw();
                  }}
                  className="min-w-0 flex-1 accent-cyan-400 disabled:opacity-30" />
                <span className="w-9 text-right font-mono text-[12px] text-white/50">{nsnsOpacity}%</span>
              </div>
              <div className="mt-1 flex items-center gap-2">
                <span className="w-12 shrink-0 text-[12px] text-white/40">亮度</span>
                <input type="range" min="50" max="400" step="1" value={nsnsBrightness} disabled={!showNSNS}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    setNSNSBrightness(value);
                    nsnsBrightnessRef.current = value;
                    requestDraw();
                  }}
                  className="min-w-0 flex-1 accent-cyan-400 disabled:opacity-30" />
                <span className="w-12 text-right font-mono text-[12px] text-white/50">{nsnsBrightness}%</span>
              </div>
            </div>
          )}
          {showNSNS && nsnsStatus !== "ready" && (
            <div className={`mt-1 text-[11px] ${nsnsStatus === "error" ? "text-red-300" : "text-cyan-200/60"}`}>
              {nsnsStatus === "error" ? "无法连接 NSNS 瓦片服务，请用双击脚本启动" : "正在加载 NSNS 坐标索引与瓦片..."}
            </div>
          )}
        </div>

        {/* NSNS H-alpha layer */}
        <div className="px-3 py-1.5 border-b border-white/5">
          <div className="flex items-center gap-1">
            <div className="mr-auto text-white/40 text-[13px]">NSNS H-alpha</div>
            <ToggleBtn label="显示" on={showNSNSHalpha} bg="rgba(220,80,90,.75)" color="#fff"
              disabled={!user}
              onClick={() => {
                if (!user) return;
                const v = !showNSNSHalpha;
                setShowNSNSHalpha(v);
                showNSNSHalphaRef.current = v;
                requestDraw();
              }} />
            <span className="h-3 w-3 shrink-0 rounded-sm border border-white/20" style={{ backgroundColor: NSNS_HALPHA_COLOR }} />
            <ToggleBtn label="着色" on={nsnsHalphaColorized} bg="rgba(255,36,36,.75)" color="#fff"
              onClick={() => {
                const value = !nsnsHalphaColorized;
                setNSNSHalphaColorized(value);
                nsnsHalphaColorizedRef.current = value;
                requestDraw();
              }} />
            <button
              type="button"
              aria-expanded={nsnsHalphaControlsExpanded}
              onClick={() => setNSNSHalphaControlsExpanded((value) => !value)}
              className="rounded px-1.5 py-1 text-[12px] text-white/45 transition-colors hover:bg-white/5 hover:text-white/70"
            >
              调整 {nsnsHalphaControlsExpanded ? "▴" : "▾"}
            </button>
          </div>
          {nsnsHalphaControlsExpanded && (
            <div className="mt-1.5 border-t border-white/5 pt-1.5">
              <div className="flex items-center gap-2">
                <span className="w-12 shrink-0 text-[12px] text-white/40">透明度</span>
                <input type="range" min="0" max="100" value={nsnsHalphaOpacity} disabled={!showNSNSHalpha}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    setNSNSHalphaOpacity(value);
                    nsnsHalphaOpacityRef.current = value / 100;
                    requestDraw();
                  }}
                  className="min-w-0 flex-1 accent-red-400 disabled:opacity-30" />
                <span className="w-9 text-right font-mono text-[12px] text-white/50">{nsnsHalphaOpacity}%</span>
              </div>
              <div className="mt-1 flex items-center gap-2">
                <span className="w-12 shrink-0 text-[12px] text-white/40">亮度</span>
                <input type="range" min="50" max="400" step="1" value={nsnsHalphaBrightness} disabled={!showNSNSHalpha}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    setNSNSHalphaBrightness(value);
                    nsnsHalphaBrightnessRef.current = value;
                    requestDraw();
                  }}
                  className="min-w-0 flex-1 accent-red-400 disabled:opacity-30" />
                <span className="w-12 text-right font-mono text-[12px] text-white/50">{nsnsHalphaBrightness}%</span>
              </div>
            </div>
          )}
          {showNSNSHalpha && nsnsHalphaStatus !== "ready" && (
            <div className={`mt-1 text-[11px] ${nsnsHalphaStatus === "error" ? "text-red-300" : "text-red-200/60"}`}>
              {nsnsHalphaStatus === "error" ? "无法连接 NSNS H-alpha 瓦片服务" : "正在加载 NSNS H-alpha 瓦片..."}
            </div>
          )}
        </div>

        {/* Grid toggles */}
        <div className="px-3 py-2 border-b border-white/5">
          <div className="text-white/40 text-[13px] mb-1">坐标网格</div>
          <div className="flex flex-wrap gap-1">
            <ToggleBtn label="赤道网格" on={showEqGrid} bg="rgba(34,34,68,.8)" color="#aaf"
              onClick={() => { const v = !showEqGrid; setShowEqGrid(v); showEqGridRef.current = v; requestDraw(); }} />
            <ToggleBtn label="银道网格" on={showGalGrid} bg="rgba(200,200,220,.35)" color="#fff"
              onClick={() => { const v = !showGalGrid; setShowGalGrid(v); showGalGridRef.current = v; requestDraw(); }} />
          </div>
        </div>

        {/* Search + coordinate jump */}
        <div className="px-3 py-2 border-b border-white/5">
          <button onClick={() => setSearchToolsExpanded((value) => !value)}
            className="flex w-full items-center gap-2 rounded border border-indigo-300/20 bg-indigo-400/10 px-2.5 py-1.5 text-left text-indigo-100/80 hover:bg-indigo-400/20">
            <Search size={16} />
            <span className="font-medium">搜索目标</span>
            <span className="ml-auto text-[11px] text-white/35">{searchToolsExpanded ? "收起" : "展开"}</span>
          </button>
          {searchToolsExpanded && (
            <div className="mt-2">
              <SidebarCoordSection
                jumpTo={(ra, dec, f) => {
                  centerRA.current = ra; centerDec.current = dec;
                  if (f !== undefined) fov.current = f;
                  updateCenterCoord(true);
                  requestDraw();
                }}
                searchQuery={searchQuery}
                onSearchInput={handleSearchInput}
                onSearchSubmit={handleSearchSubmit}
                searchResults={searchResults}
                showDropdown={showSearchDropdown}
                setShowDropdown={setShowSearchDropdown}
              />
            </div>
          )}
        </div>

        {/* Camera sim toggle + panel */}
        <div className="px-3 py-2 border-b border-white/5">
          <button
            onClick={() => {
              const v = !showCamSim;
              setShowCamSim(v);
              showCamSimRef.current = v;
              if (v && camEntries.length === 0) {
                commitCamEntries([createCamEntry()]);
              }
              requestDraw();
            }}
            className={`w-full px-2.5 py-1 rounded text-[13px] font-semibold transition-all select-none border ${
              showCamSim
                ? "bg-red-500/70 border-red-400/60 text-white shadow-[0_0_8px_rgba(255,60,60,.4)]"
                : "bg-transparent border-amber-400/50 text-amber-300/90 hover:bg-amber-500/15"
            }`}
          >
            📷 相机视场模拟
          </button>
          {showCamSim && (
            <div className="mt-2 text-xs text-white/80">
              {camEntries.map((cfg, i) => {
                const cameraId = cfg.id || `camera-${i}`;
                const targets = targetsForCamera(cfg, i);
                const allTargetsHidden = targets.length > 0 && targets.every((target) => target.hidden);
                const candidatesCollapsed = Boolean(candidateGroupsCollapsed[cameraId]);
                return (
                  <div key={cameraId} className="mb-2 rounded border border-white/7 bg-white/[.035] p-1.5">
                    <div className="flex items-center gap-1">
                      <input value={cfg.name || ""} onChange={(event) => patchCamEntry(i, { name: event.target.value })}
                        placeholder={`${cfg.focal}mm 视场`}
                        className="min-w-0 flex-1 rounded border border-white/10 bg-black/15 px-2 py-1 text-xs font-medium text-white/85 outline-none placeholder:text-white/45 focus:border-indigo-300/40" />
                      <button onClick={() => patchCamEntry(i, { hidden: !cfg.hidden })}
                        className="rounded border border-white/10 px-1.5 py-1 text-[11px] text-white/55 hover:bg-white/8">
                        {cfg.hidden ? "显示" : "隐藏"}
                      </button>
                      <button title={cfg.collapsed ? "展开视场" : "折叠视场"} onClick={() => patchCamEntry(i, { collapsed: !cfg.collapsed })}
                        className="rounded px-1.5 py-1 text-white/45 hover:bg-white/8">{cfg.collapsed ? "▾" : "▴"}</button>
                    </div>
                    {!cfg.collapsed && (
                      <>
                        <div className="mt-1.5 flex items-center gap-1 flex-wrap">
                          <span className="text-white/40">f</span>
                          <input type="number" value={cfg.focal} onChange={event => updateCamEntry(i, "focal", event.target.value)}
                            className="w-16 rounded border border-white/10 bg-white/5 px-1 py-0.5 text-center text-xs outline-none" />
                          <span className="text-white/40">mm</span>
                          <input type="number" value={cfg.sw} onChange={event => updateCamEntry(i, "sw", event.target.value)}
                            className="w-14 rounded border border-white/10 bg-white/5 px-1 py-0.5 text-center text-xs outline-none" />
                          <span className="text-white/40">×</span>
                          <input type="number" value={cfg.sh} onChange={event => updateCamEntry(i, "sh", event.target.value)}
                            className="w-14 rounded border border-white/10 bg-white/5 px-1 py-0.5 text-center text-xs outline-none" />
                          <span className="text-white/40">mm</span>
                        </div>
                        <div className="mt-1 flex items-center gap-1 flex-wrap">
                          <span className="text-white/40">∠</span>
                          <input type="number" value={cfg.angle} onChange={event => updateCamEntry(i, "angle", event.target.value)}
                            className="w-14 rounded border border-white/10 bg-white/5 px-1 py-0.5 text-center text-xs outline-none" />
                          <span className="text-white/40">°</span>
                          <span className="ml-2 text-white/40">Mosaic</span>
                          <input type="number" value={cfg.mosX} onChange={event => updateCamEntry(i, "mosX", event.target.value)}
                            className="w-10 rounded border border-white/10 bg-white/5 px-1 py-0.5 text-center text-xs outline-none" />
                          <span className="text-white/40">×</span>
                          <input type="number" value={cfg.mosY} onChange={event => updateCamEntry(i, "mosY", event.target.value)}
                            className="w-10 rounded border border-white/10 bg-white/5 px-1 py-0.5 text-center text-xs outline-none" />
                          <span className="text-white/40">重叠</span>
                          <input type="number" value={cfg.overlap} onChange={event => updateCamEntry(i, "overlap", event.target.value)}
                            className="w-11 rounded border border-white/10 bg-white/5 px-1 py-0.5 text-center text-xs outline-none" />
                          <span className="text-white/40">%</span>
                        </div>
                        <div className="mt-2 border-t border-white/5 pt-2">
                          <div className="mb-1 flex items-center gap-1">
                            <button onClick={() => setCandidateGroupsCollapsed((current) => ({ ...current, [cameraId]: !candidatesCollapsed }))}
                              className="flex min-w-0 flex-1 items-center justify-between rounded px-1 py-1 text-left text-white/55 hover:bg-white/5">
                              <span>候选目标目录</span>
                              <span className="text-[11px] text-white/30">{targets.length} 个 {candidatesCollapsed ? "▾" : "▴"}</span>
                            </button>
                            <button disabled={targets.length === 0} onClick={() => setCameraTargetsHidden(cfg, i, !allTargetsHidden)}
                              className="rounded border border-white/10 px-1.5 py-1 text-[11px] text-white/45 hover:bg-white/8 disabled:opacity-25">
                              {allTargetsHidden ? "全部显示" : "全部隐藏"}
                            </button>
                          </div>
                          {!candidatesCollapsed && (
                            <>
                              <div className="flex gap-1">
                                <input value={candidateNames[cameraId] || ""}
                                  onChange={(event) => setCandidateNames((current) => ({ ...current, [cameraId]: event.target.value }))}
                                  onKeyDown={(event) => { if (event.key === "Enter") recordCameraCandidate(cfg, i); }}
                                  disabled={!user} placeholder="候选目标名称"
                                  className="min-w-0 flex-1 rounded border border-white/10 bg-white/5 px-2 py-1 text-xs outline-none placeholder:text-white/20 disabled:opacity-35" />
                                <button onClick={() => recordCameraCandidate(cfg, i)} disabled={!user}
                                  className="rounded bg-amber-500/55 px-2 py-1 text-xs text-amber-50 hover:bg-amber-400/70 disabled:opacity-30">记录</button>
                              </div>
                              <div className="mt-1 max-h-32 space-y-1 overflow-y-auto">
                                {targets.map((target) => (
                                  <div key={target.id} className="flex items-center gap-1 rounded bg-amber-300/[.035] px-1 py-0.5">
                                    <input defaultValue={target.name} onBlur={(event) => renameCameraCandidate(target, event.target.value)}
                                      onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
                                      className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-xs text-amber-100/80 outline-none focus:border-amber-300/30" />
                                    <button title="跳转" onClick={() => jumpTo(target.ra, target.dec, target.fov)}
                                      className="rounded px-1 text-indigo-200/70 hover:bg-indigo-500/25">定位</button>
                                    <button title={target.hidden ? "显示候选框" : "隐藏候选框"} onClick={() => saveCameraCandidateTarget({ ...target, hidden: !target.hidden })}
                                      className="rounded px-1 text-white/35 hover:bg-white/8">{target.hidden ? "显示" : "隐藏"}</button>
                                    <button title="删除候选目标" onClick={() => deleteCameraCandidateTarget(target.id)}
                                      className="rounded px-1 text-white/25 hover:bg-red-500/20 hover:text-red-200">×</button>
                                  </div>
                                ))}
                              </div>
                            </>
                          )}
                        </div>
                        <button onClick={() => removeCamEntry(i)}
                          className="mt-2 w-full rounded border border-red-300/15 bg-red-500/10 py-1 text-[11px] text-red-200/60 hover:bg-red-500/20 hover:text-red-100">
                          删除视场所有数据
                        </button>
                      </>
                    )}
                  </div>
                );
              })}
              <button onClick={addCamEntry}
                className="w-full rounded bg-indigo-500/40 py-1 text-xs text-white/80 hover:bg-indigo-400/60">
                + 添加视场
              </button>
              {!user && <div className="mt-1 text-[11px] text-white/25">登录后可记录并云端保存每个视场的候选目标</div>}
            </div>
          )}
        </div>

      </div>

      {/* ── Canvas area ── */}
      <div className="relative flex-1 min-w-0 min-h-0" ref={containerRef}>
        <style>{`
          #nsns-aladin-renderer > :not(canvas),
          #nsns-halpha-aladin-renderer > :not(canvas) {
            display: none !important;
          }
        `}</style>
        <div
          id="nsns-aladin-renderer"
          ref={nsnsHostRef}
          aria-hidden="true"
          className="absolute inset-0 overflow-hidden opacity-0 pointer-events-none"
          style={{ width: "100%", height: "100%", minHeight: "100%", backgroundColor: "#000000" }}
        />
        <div
          id="nsns-halpha-aladin-renderer"
          ref={nsnsHalphaHostRef}
          aria-hidden="true"
          className="absolute inset-0 overflow-hidden opacity-0 pointer-events-none"
          style={{ width: "100%", height: "100%", minHeight: "100%", backgroundColor: "#000000" }}
        />
        <canvas
          ref={canvasRef}
          className="absolute inset-0 z-10 w-full h-full cursor-crosshair"
          style={{ touchAction: "none" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={cancelPointerDrag}
          onLostPointerCapture={cancelPointerDrag}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
        />

        {loadError && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50 px-4">
            <div className="max-w-md rounded-lg border border-red-400/30 bg-red-950/80 p-4 text-sm text-red-100 shadow-xl">
              <div className="mb-1 font-semibold">星图数据加载失败</div>
              <div className="font-mono text-xs text-red-100/80">{loadError}</div>
            </div>
          </div>
        )}

        {/* Hover filename label — top-left */}
        {hoverOverlay && (
          <div className="absolute top-2 left-2 z-20 rounded bg-black/75 px-2.5 py-1 text-sm text-blue-100 pointer-events-none">
            {parseFilename(hoverOverlay.name).target}
          </div>
        )}

        {/* Detail loading spinner */}
        {detailLoading && (
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-2 rounded-xl bg-black/80 backdrop-blur-sm px-5 py-4 pointer-events-none z-50">
            <svg className="animate-spin h-8 w-8 text-indigo-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span className="text-xs text-white/80">加载高清图中...</span>
            <span className="text-xs text-white/40 max-w-[200px] truncate">{parseFilename(detailLoading).target}</span>
          </div>
        )}

        {/* Selected overlay info panel — bottom-left */}
        {selectedOverlay && (() => {
          const info = parseFilename(selectedOverlay.name);
          return (
            <div className="absolute bottom-3 left-3 z-20 max-w-xs rounded-lg bg-black/80 backdrop-blur-sm border border-white/10 p-3 text-xs text-white/80 pointer-events-none">
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
              <div className="mt-1">天体: {selectedOverlay.objects.join(", ") || "无"}</div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
