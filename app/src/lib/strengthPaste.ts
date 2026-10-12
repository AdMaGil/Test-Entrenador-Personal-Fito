import type { StrengthSet } from "./types";

/**
 * Convierte el "Bloque 1" que devuelve el prompt de extracción de WODs (una tabla en texto plano
 * con formato `Ejercicio | Serie | Reps | Peso(kg)`) en series listas para el editor de fuerza.
 * Ignora cabecera y separadores; un peso no numérico (p.ej. "revisar") se deja en blanco para que
 * el usuario lo rellene a mano, que es el único dato que una foto no puede darnos con fiabilidad.
 */
export function parseStrengthPaste(text: string): StrengthSet[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const out: StrengthSet[] = [];
  for (const line of lines) {
    if (!line.includes("|")) continue;
    const cols = line.split("|").map((c) => c.trim());
    if (cols.length < 4) continue;
    const [exercise, serieRaw, repsRaw, pesoRaw] = cols;
    if (!exercise || /^ejercicio$/i.test(exercise) || /^-+$/.test(exercise)) continue; // cabecera o separador
    const set_number = /^\d+$/.test(serieRaw) ? Number(serieRaw) : out.filter((s) => s.exercise === exercise).length + 1;
    const reps = /^\d+$/.test(repsRaw) ? Number(repsRaw) : null;
    const weight_kg = /^\d+([.,]\d+)?$/.test(pesoRaw) ? Number(pesoRaw.replace(",", ".")) : null;
    out.push({ exercise, set_number, reps, weight_kg, duration_s: null, notes: null });
  }
  return out;
}
