import { lazy, Suspense } from "react";
import { createHashRouter, Navigate, Route, RouterProvider, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Empty, Loading } from "./components/ui";
import { useApp } from "./data/AppData";
import Login from "./pages/Login";
import Today from "./pages/Today";

const Calendar = lazy(() => import("./pages/Calendar"));
const Activities = lazy(() => import("./pages/Activities"));
const ActivityDetail = lazy(() => import("./pages/ActivityDetail"));
const Evolution = lazy(() => import("./pages/Evolution"));
const RoutesPage = lazy(() => import("./pages/Routes"));
const Health = lazy(() => import("./pages/Health"));
const Physique = lazy(() => import("./pages/Physique"));
const Coach = lazy(() => import("./pages/Coach"));
const Settings = lazy(() => import("./pages/Settings"));

// Router «de datos» (mismas rutas que antes con HashRouter): permite avisar
// antes de salir de una pantalla con cambios sin guardar (useBlocker).
const router = createHashRouter([{ path: "*", element: <Shell /> }]);

export default function App() {
  const { status, repo } = useApp();

  if (status === "sin-sesion" && !repo) return <Login />;
  if (status === "cargando" && !repo) return <Loading text="Comprobando sesión…" />;

  return <RouterProvider router={router} />;
}

function Shell() {
  const { status, error, refresh, signOut } = useApp();
  return (
      <Layout>
        {status === "cargando" ? <Loading text="Cargando tus datos…" /> : status === "error" ? (
          <Empty title="No se pudieron cargar los datos" action={<div className="row"><button className="btn" onClick={refresh}>Reintentar</button><button className="btn ghost" onClick={signOut}>Cerrar sesión</button></div>}>
            {error}. Si es la primera vez, comprueba que las migraciones de la base de datos están aplicadas.
          </Empty>
        ) : (
          <Suspense fallback={<Loading />}>
            <Routes>
              <Route path="/" element={<Navigate to="/hoy" replace />} />
              <Route path="/hoy" element={<Today />} />
              <Route path="/calendario" element={<Calendar />} />
              <Route path="/actividades" element={<Activities />} />
              <Route path="/actividades/:id" element={<ActivityDetail />} />
              <Route path="/evolucion" element={<Evolution />} />
              <Route path="/rutas" element={<RoutesPage />} />
              <Route path="/salud" element={<Health />} />
              <Route path="/fisico" element={<Physique />} />
              <Route path="/entrenador" element={<Coach />} />
              <Route path="/ajustes" element={<Settings />} />
              <Route path="*" element={<Navigate to="/hoy" replace />} />
            </Routes>
          </Suspense>
        )}
      </Layout>
  );
}
