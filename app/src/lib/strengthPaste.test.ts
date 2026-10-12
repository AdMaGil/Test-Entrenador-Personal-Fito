import { describe, expect, it } from "vitest";
import { parseStrengthPaste } from "./strengthPaste";

describe("parseStrengthPaste", () => {
  it("convierte filas tabla en series, ignorando cabecera", () => {
    const text = [
      "Ejercicio | Serie | Reps | Peso(kg)",
      "2 DB Devil Press | 1 | 15 | 20",
      "KB High Swing | 1 | 30 | revisar",
    ].join("\n");
    const out = parseStrengthPaste(text);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ exercise: "2 DB Devil Press", set_number: 1, reps: 15, weight_kg: 20 });
    expect(out[1]).toMatchObject({ exercise: "KB High Swing", set_number: 1, reps: 30, weight_kg: null });
  });

  it("ignora líneas separadoras y sin formato de tabla", () => {
    const text = "Ejercicio | Serie | Reps | Peso(kg)\n--- | --- | --- | ---\nSentadilla | 1 | 5 | 80\nAlgo suelto sin pipes";
    const out = parseStrengthPaste(text);
    expect(out).toEqual([{ exercise: "Sentadilla", set_number: 1, reps: 5, weight_kg: 80, duration_s: null, notes: null }]);
  });

  it("acepta coma decimal en el peso", () => {
    const out = parseStrengthPaste("Peso muerto | 2 | 8 | 62,5");
    expect(out[0].weight_kg).toBe(62.5);
  });

  it("devuelve vacío si no hay texto", () => {
    expect(parseStrengthPaste("")).toEqual([]);
  });
});
