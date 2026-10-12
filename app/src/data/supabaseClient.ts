import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabaseConfigured = Boolean(url && anonKey);

// La clave anónima es pública por diseño: lo que protege los datos es el
// inicio de sesión y las políticas RLS de cada tabla y del almacenamiento.
export const supabase: SupabaseClient | null = supabaseConfigured
  ? createClient(url as string, anonKey as string, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;

export const coachAiEnabled = String(import.meta.env.VITE_COACH_AI_ENABLED ?? "false") === "true";
