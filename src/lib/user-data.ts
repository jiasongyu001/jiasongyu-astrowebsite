export type AuthUser = {
  id: string;
  username: string;
  isAdmin: boolean;
  createdAt: string;
};

export type CameraConfig = {
  id?: string;
  name?: string;
  hidden?: boolean;
  collapsed?: boolean;
  focal: number;
  sw: number;
  sh: number;
  angle: number;
  mosX: number;
  mosY: number;
  overlap: number;
};

export type SavedCameraField = {
  id: string;
  name: string;
  entries: CameraConfig[];
  updatedAt: string;
};

export type FavoriteTarget = {
  id: string;
  name: string;
  ra: number;
  dec: number;
  fov?: number;
  notes?: string;
  createdAt: string;
};

export type CameraCandidateTarget = {
  id: string;
  cameraId?: string;
  name: string;
  ra: number;
  dec: number;
  fov: number;
  entries: CameraConfig[];
  hidden?: boolean;
  createdAt: string;
};

export type SkyMapState = {
  centerRA: number;
  centerDec: number;
  fov: number;
  showDeepSkyPhotos: boolean;
  showNSNS: boolean;
  nsnsOpacity: number;
  nsnsBrightness: number;
  nsnsColorized: boolean;
  showNSNSHalpha: boolean;
  nsnsHalphaOpacity: number;
  nsnsHalphaBrightness: number;
  nsnsHalphaColorized: boolean;
  showEqGrid: boolean;
  showGalGrid: boolean;
  showCenterCrosshair: boolean;
  showCamSim: boolean;
};

export type UserDocument = {
  version: 1;
  cameraFields: SavedCameraField[];
  cameraEntries: CameraConfig[];
  favoriteTargets: FavoriteTarget[];
  cameraCandidateTargets: CameraCandidateTarget[];
  mapState: SkyMapState | null;
};

export const EMPTY_USER_DOCUMENT: UserDocument = {
  version: 1,
  cameraFields: [],
  cameraEntries: [],
  favoriteTargets: [],
  cameraCandidateTargets: [],
  mapState: null,
};
