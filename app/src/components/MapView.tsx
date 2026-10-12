import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";

export default function MapView({ points, color }: { points: [number, number][]; color: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let map: import("leaflet").Map | undefined;
    let cancelled = false;
    (async () => {
      const L = await import("leaflet");
      if (cancelled || !ref.current) return;
      map = L.map(ref.current, { zoomControl: true, attributionControl: true, scrollWheelZoom: false });
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 18, attribution: "© OpenStreetMap",
      }).addTo(map);
      const line = L.polyline(points, { color, weight: 4, opacity: 0.95 }).addTo(map);
      map.fitBounds(line.getBounds(), { padding: [16, 16] });
    })();
    return () => { cancelled = true; map?.remove(); };
  }, [points, color]);
  return <div ref={ref} style={{ height: 300 }} aria-label="Mapa del recorrido" role="img" />;
}
