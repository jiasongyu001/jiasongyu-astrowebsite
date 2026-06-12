"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  EMPTY_USER_DOCUMENT,
  type AuthUser,
  type FavoriteTarget,
  type SavedCameraField,
  type SkyMapState,
  type UserDocument,
} from "@/lib/user-data";

type UserDataContextValue = {
  user: AuthUser | null;
  checkingAuth: boolean;
  document: UserDocument;
  documentLoaded: boolean;
  syncStatus: "idle" | "saving" | "saved" | "error";
  authError: string | null;
  login: (email: string, password: string) => Promise<boolean>;
  register: (email: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  saveCameraField: (field: SavedCameraField) => void;
  deleteCameraField: (id: string) => void;
  saveFavoriteTarget: (target: FavoriteTarget) => void;
  deleteFavoriteTarget: (id: string) => void;
  setMapState: (state: SkyMapState) => void;
  importFavoriteTargets: (targets: FavoriteTarget[]) => void;
};

const UserDataContext = createContext<UserDataContextValue | null>(null);

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const payload = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(payload.error || `请求失败（${response.status}）`);
  return payload as T;
}

function normalizeDocument(value: Partial<UserDocument> | null | undefined): UserDocument {
  return {
    version: 1,
    cameraFields: Array.isArray(value?.cameraFields) ? value.cameraFields.slice(0, 100) : [],
    favoriteTargets: Array.isArray(value?.favoriteTargets) ? value.favoriteTargets.slice(0, 1000) : [],
    mapState: value?.mapState ?? null,
  };
}

export function UserDataProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [document, setDocument] = useState<UserDocument>(EMPTY_USER_DOCUMENT);
  const [documentLoaded, setDocumentLoaded] = useState(false);
  const [syncStatus, setSyncStatus] = useState<UserDataContextValue["syncStatus"]>("idle");
  const [authError, setAuthError] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canSave = useRef(false);

  const loadDocument = useCallback(async () => {
    setDocumentLoaded(false);
    canSave.current = false;
    const result = await api<{ document: UserDocument }>("/api/user/data");
    setDocument(normalizeDocument(result.document));
    setDocumentLoaded(true);
    canSave.current = true;
    setSyncStatus("saved");
  }, []);

  useEffect(() => {
    api<{ user: AuthUser | null }>("/api/auth/me")
      .then(async (result) => {
        setUser(result.user);
        if (result.user) await loadDocument();
      })
      .catch(() => setUser(null))
      .finally(() => setCheckingAuth(false));
  }, [loadDocument]);

  useEffect(() => {
    if (!user || !documentLoaded || !canSave.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      setSyncStatus("saving");
      api<{ ok: true }>("/api/user/data", {
        method: "PUT",
        body: JSON.stringify({ document }),
      })
        .then(() => setSyncStatus("saved"))
        .catch(() => setSyncStatus("error"));
    }, 1200);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [document, documentLoaded, user]);

  const authenticate = useCallback(async (mode: "login" | "register", email: string, password: string) => {
    setAuthError(null);
    try {
      const result = await api<{ user: AuthUser }>(`/api/auth/${mode}`, {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      setUser(result.user);
      await loadDocument();
      return true;
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "登录失败");
      return false;
    }
  }, [loadDocument]);

  const logout = useCallback(async () => {
    await api("/api/auth/logout", { method: "POST", body: "{}" }).catch(() => undefined);
    canSave.current = false;
    setUser(null);
    setDocument(EMPTY_USER_DOCUMENT);
    setDocumentLoaded(false);
    setSyncStatus("idle");
  }, []);

  const update = useCallback((mutate: (current: UserDocument) => UserDocument) => {
    if (!user) return;
    setDocument(mutate);
  }, [user]);

  const value = useMemo<UserDataContextValue>(() => ({
    user,
    checkingAuth,
    document,
    documentLoaded,
    syncStatus,
    authError,
    login: (email, password) => authenticate("login", email, password),
    register: (email, password) => authenticate("register", email, password),
    logout,
    saveCameraField: (field) => update((current) => ({
      ...current,
      cameraFields: [field, ...current.cameraFields.filter((item) => item.id !== field.id)].slice(0, 100),
    })),
    deleteCameraField: (id) => update((current) => ({
      ...current,
      cameraFields: current.cameraFields.filter((field) => field.id !== id),
    })),
    saveFavoriteTarget: (target) => update((current) => ({
      ...current,
      favoriteTargets: [target, ...current.favoriteTargets.filter((item) => item.id !== target.id)].slice(0, 1000),
    })),
    deleteFavoriteTarget: (id) => update((current) => ({
      ...current,
      favoriteTargets: current.favoriteTargets.filter((target) => target.id !== id),
    })),
    setMapState: (state) => update((current) => ({ ...current, mapState: state })),
    importFavoriteTargets: (targets) => update((current) => ({
      ...current,
      favoriteTargets: targets.slice(0, 1000),
    })),
  }), [authError, authenticate, checkingAuth, document, documentLoaded, logout, syncStatus, update, user]);

  return <UserDataContext.Provider value={value}>{children}</UserDataContext.Provider>;
}

export function useUserData(): UserDataContextValue {
  const value = useContext(UserDataContext);
  if (!value) throw new Error("useUserData must be used inside UserDataProvider");
  return value;
}
