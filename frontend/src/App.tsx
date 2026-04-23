import { Navigate, Route, Routes } from "react-router-dom";
import { LoginPage } from "./auth/LoginPage";
import { useAuth } from "./auth/AuthProvider";
import { MapPage } from "./map/MapPage";
import { AdminPage } from "./admin/AdminPage";
import { RegionsPage } from "./offline/RegionsPage";
import { ProjectLandingPage, ProjectsPage } from "./projects/ProjectsPage";

export function App(): JSX.Element {
  const { user } = useAuth();

  return (
    <Routes>
      <Route path="/" element={user ? <ProjectLandingPage /> : <Navigate to="/login" replace />} />
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/projects"
        element={user ? <ProjectsPage /> : <Navigate to="/login" replace />}
      />
      <Route
        path="/projects/:projectId/map"
        element={user ? <MapPage /> : <Navigate to="/login" replace />}
      />
      <Route
        path="/projects/:projectId/regions"
        element={user ? <RegionsPage /> : <Navigate to="/login" replace />}
      />
      <Route path="/map" element={<Navigate to="/" replace />} />
      <Route path="/regions" element={<Navigate to="/" replace />} />
      <Route
        path="/admin"
        element={
          user?.role === "admin" ? <AdminPage /> : <Navigate to="/" replace />
        }
      />
      <Route path="*" element={<Navigate to={user ? "/" : "/login"} replace />} />
    </Routes>
  );
}
