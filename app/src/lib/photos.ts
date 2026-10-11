// Utilidades de fotografías. Las fotos nunca salen hacia servicios externos:
// se procesan en el navegador y se guardan en el bucket privado.

export interface DisplayVersion {
  blob: Blob;
  width: number;
  height: number;
}

/**
 * Versión optimizada para visualizar (máx. 1600 px, JPEG). Al re-codificar
 * se eliminan los metadatos EXIF (incluida la ubicación) de esta copia.
 * El original se conserva tal cual en el almacenamiento privado.
 * Devuelve null si el navegador no puede decodificar el formato (p. ej. HEIC).
 */
export async function makeDisplayVersion(file: Blob, maxSide = 1600): Promise<DisplayVersion | null> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.86));
    return blob ? { blob, width: w, height: h } : null;
  } catch {
    return null;
  }
}

export function extensionOf(file: File): string {
  const fromName = file.name.split(".").pop()?.toLowerCase();
  if (fromName && fromName.length <= 5) return fromName;
  return (file.type.split("/")[1] || "jpg").toLowerCase();
}

export const POSE_LABEL = { frontal: "Frontal", perfil: "Perfil", espalda: "Espalda" } as const;
export const POSES = ["frontal", "perfil", "espalda"] as const;

export const PHOTO_GUIDE: { title: string; text: string }[] = [
  { title: "Luz", text: "Misma habitación y misma hora del día. Luz frontal o lateral suave; evita contraluces y flashes directos." },
  { title: "Distancia", text: "Marca en el suelo dónde colocas el móvil y dónde te colocas tú. Usa siempre la misma distancia y altura (a la altura del ombligo)." },
  { title: "Postura", text: "De pie, relajado, brazos ligeramente separados del cuerpo y sin contraer. Para el perfil, gira siempre hacia el mismo lado." },
  { title: "Ropa", text: "Siempre la misma ropa ajustada o el mismo bañador, para que las comparaciones sean justas." },
  { title: "Encuadre", text: "Cuerpo completo de cabeza a pies, centrado, con temporizador o trípode. Después puedes ajustar escala y posición sin deformar la imagen." },
  { title: "Momento", text: "Mismo momento del día y en condiciones parecidas (por ejemplo, en ayunas y antes de entrenar)." },
];
