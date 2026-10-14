// Mapa agregado de varias rutas (MTB / e-MTB) a la vez. Carga perezosa de
// Leaflet, igual que MapView; aquí se dibuja una polilínea por ruta.
import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";

export interface RouteLine {
  id: string;
  points: [number, number][];
  color: string;
  label: string;
}

export default function RoutesMap({ routes, height = 420 }: { routes: RouteLine[]; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let map: import("leaflet").Map | undefined;
    let cancelled = false;
    (async () => {
      const L = await import("leaflet");
      if (cancelled || !ref.current || !routes.length) return;
      map = L.map(ref.current, { zoomControl: true, attributionControl: true, scrollWheelZoom: false });
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 18, attribution: "© OpenStreetMap",
      }).addTo(map);
      const lines: import("leaflet").Polyline[] = [];
      for (const r of routes) {
        if (r.points.length < 2) continue;
        const line = L.polyline(r.points, { color: r.color, weight: 3, opacity: 0.75 })
          .bindTooltip(r.label, { sticky: true });
        line.addTo(map);
        lines.push(line);
      }
      if (lines.length) {
        const group = L.featureGroup(lines);
        map.fitBounds(group.getBounds(), { padding: [20, 20] });
      } else {
        map.setView([40.4, -3.7], 6); // sin rutas con GPS: vista general de España
      }
    })();
    return () => { cancelled = true; map?.remove(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routes]);
  return <div ref={ref} style={{ height }} aria-label="Mapa con todas las rutas" role="img" />;
}
