import type { Session } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DEFAULT_TZ, todayISO } from "../lib/dates";
import type { DataBundle, Profile, Units } from "../lib/types";
import { DemoRepo } from "./demo";
import { EMPTY_BUNDLE, type Repo } from "./repo";
import { supabase } from "./supabaseClient";
import { SupabaseRepo } from "./supabaseRepo";

type Status = "cargando" | "sin-sesion" | "listo" | "error";

interface Ctx {
  status: Status;
  error: string | null;
  session: Session | null;
  repo: Repo | null;
  mode: "real" | "demo" | null;
  data: DataBundle;
  today: string;
  tz: string;
  units: Units;
  theme: "dark" | "light";
  refresh: () => Promise<void>;
  run: <T>(fn: (repo: Repo) => Promise<T>, okMessage?: string) => Promise<T | undefined>;
  startDemo: () => void;
  exitDemo: () => void;
  signOut: () => Promise<void>;
  toast: { text: string; kind: "ok" | "error" } | null;
  notify: (text: string, kind?: "ok" | "error") => void;
}

const AppDataContext = createContext<Ctx | null>(null);

const DEFAULT_UNITS: Units = { weight: "kg", distance: "km", elevation: "m" };

function systemTheme(): "dark" | "light" {
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function AppDataProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [repo, setRepo] = useState<Repo | null>(null);
  const [status, setStatus] = useState<Status>("cargando");
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<DataBundle>(EMPTY_BUNDLE);
  const [toast, setToast] = useState<Ctx["toast"]>(null);
  const toastTimer = useRef<number | undefined>(undefined);

  const notify = useCallback((text: string, kind: "ok" | "error" = "ok") => {
    setToast({ text, kind });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), kind === "error" ? 7000 : 3500);
  }, []);

  // Autenticación
  useEffect(() => {
    if (!supabase) { setStatus("sin-sesion"); return; }
    supabase.auth.getSession().then(({ data: d }) => {
      setSession(d.session);
      if (!d.session) setStatus("sin-sesion");
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (!s) {
        setRepo((r) => (r?.mode === "real" ? null : r));
        setStatus((st) => (st === "listo" ? "sin-sesion" : st));
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session && supabase) setRepo(new SupabaseRepo(supabase, session.user.id));
  }, [session]);

  const refresh = useCallback(async () => {
    if (!repo) return;
    try {
      const b = await repo.loadAll();
      setData(b);
      setError(null);
      setStatus("listo");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }, [repo]);

  useEffect(() => {
    if (repo) { setStatus("cargando"); void refresh(); }
    else setData(EMPTY_BUNDLE);
  }, [repo, refresh]);

  const run = useCallback(async <T,>(fn: (r: Repo) => Promise<T>, okMessage?: string) => {
    if (!repo) return undefined;
    try {
      const out = await fn(repo);
      await refresh();
      if (okMessage) notify(okMessage);
      return out;
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), "error");
      return undefined;
    }
  }, [repo, refresh, notify]);

  const profile: Profile | null = data.profile;
  const tz = profile?.timezone || DEFAULT_TZ;
  const theme = profile?.theme === "light" ? "light" : profile?.theme === "system" ? systemTheme() : "dark";

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "light" ? "#f3f4f6" : "#111316");
  }, [theme]);

  const value = useMemo<Ctx>(() => ({
    status, error, session, repo, mode: repo?.mode ?? null, data,
    today: todayISO(tz), tz, units: profile?.units ?? DEFAULT_UNITS, theme,
    refresh, run, notify, toast,
    startDemo: () => setRepo(new DemoRepo()),
    exitDemo: () => { setRepo(null); setStatus(session ? "cargando" : "sin-sesion"); if (session && supabase) setRepo(new SupabaseRepo(supabase, session.user.id)); },
    signOut: async () => { await supabase?.auth.signOut(); setRepo(null); setStatus("sin-sesion"); },
  }), [status, error, session, repo, data, tz, profile, theme, refresh, run, notify, toast]);

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}

export function useApp(): Ctx {
  const ctx = useContext(AppDataContext);
  if (!ctx) throw new Error("useApp fuera de AppDataProvider");
  return ctx;
}
