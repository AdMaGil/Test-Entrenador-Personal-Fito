import type { PlanCategory, Sport } from "./types";

// Paleta validada (dataviz/validate_palette.js) contra las superficies de
// la app: sin FAIL; aviso CVD ≈7 → toda marca de deporte va SIEMPRE con
// su nombre en texto (nunca se identifica solo por color).
const DARK: Record<PlanCategory, string> = {
  hiit: "#e46f2a",
  emtb: "#1a98bb",
  mtb: "#1d7a52",
  run: "#9b7aeb",
  otro: "#8a9099",
  descanso: "#5c636d",
};
const LIGHT: Record<PlanCategory, string> = {
  hiit: "#d8752a",
  emtb: "#0e7aa5",
  mtb: "#2a7531",
  run: "#a85ccc",
  otro: "#6b7280",
  descanso: "#9aa1ab",
};

export const SPORTS: Sport[] = ["hiit", "emtb", "mtb", "run", "otro"];

export const SPORT_LABEL: Record<PlanCategory, string> = {
  hiit: "HIIT / Funcional",
  emtb: "e-MTB",
  mtb: "MTB",
  run: "Carrera",
  otro: "Otro",
  descanso: "Descanso",
};

export const SPORT_SHORT: Record<PlanCategory, string> = {
  hiit: "HIIT",
  emtb: "e-MTB",
  mtb: "MTB",
  run: "Carrera",
  otro: "Otro",
  descanso: "Descanso",
};

export const SPORT_DESCRIPTION: Record<Sport, string> = {
  hiit: "HIIT y entrenamiento funcional, incluidas sesiones tipo Hyrox",
  emtb: "Bicicleta eléctrica de montaña",
  mtb: "Bicicleta de montaña convencional, sin motor",
  run: "Carrera a pie",
  otro: "Actividad sin clasificar",
};

export function sportColor(cat: PlanCategory, theme: "dark" | "light"): string {
  return (theme === "light" ? LIGHT : DARK)[cat];
}

export function isBike(cat: PlanCategory): boolean {
  return cat === "emtb" || cat === "mtb";
}

// Traducción legible del tipo original del origen
const SOURCE_TYPE_LABEL: Record<string, string> = {
  HighIntensityIntervalTraining: "Entrenamiento HIIT",
  Crossfit: "Crossfit",
  WeightTraining: "Fuerza",
  Workout: "Entrenamiento",
  EMountainBikeRide: "Bici eléctrica de montaña",
  EBikeRide: "Bici eléctrica",
  MountainBikeRide: "Bici de montaña",
  Ride: "Ciclismo",
  GravelRide: "Gravel",
  VirtualRide: "Ciclismo virtual",
  Run: "Carrera",
  TrailRun: "Carrera por montaña",
  VirtualRun: "Carrera en cinta",
};

export function sourceTypeLabel(t: string | null): string {
  if (!t) return "Sin tipo de origen";
  return SOURCE_TYPE_LABEL[t] ?? t;
}
