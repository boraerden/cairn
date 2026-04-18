import { Navigate, Route, Routes } from "react-router-dom";
import { LoginPage } from "./auth/LoginPage";
import { useAuth } from "./auth/AuthProvider";
import { MapPage } from "./map/MapPage";
import { AdminPage } from "./admin/AdminPage";
import { RegionsPage } from "./offline/RegionsPage";

export function App(): JSX.Element {
  const { user } = useAuth();

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/map"
        element={user ? <MapPage /> : <Navigate to="/login" replace />}
      />
      <Route
        path="/regions"
        element={user ? <RegionsPage /> : <Navigate to="/login" replace />}
      />
      <Route
        path="/admin"
        element={
          user?.role === "admin" ? <AdminPage /> : <Navigate to="/map" replace />
        }
      />
      <Route path="*" element={<Navigate to={user ? "/map" : "/login"} replace />} />
    </Routes>
  );
}
