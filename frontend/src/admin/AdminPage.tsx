import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../api";
import type { UserRole } from "@cairn/types";

interface AdminUser {
  email: string;
  role: UserRole;
  createdAt: string;
}

export function AdminPage(): JSX.Element {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>("editor");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api<AdminUser[]>("GET", "/admin/users");
      setUsers(res);
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function addUser(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("POST", "/admin/users", { body: { email, password, role } });
      setEmail("");
      setPassword("");
      await load();
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function removeUser(email: string) {
    if (!confirm(`Remove ${email}?`)) return;
    try {
      await api("DELETE", `/admin/users/${encodeURIComponent(email)}`);
      await load();
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
    }
  }

  return (
    <div className="admin-shell">
      <div className="row">
        <h1 style={{ margin: 0 }}>Users</h1>
        <div style={{ flex: 1 }} />
        <Link to="/map">
          <button type="button">Back to map</button>
        </Link>
      </div>

      <form className="row" onSubmit={addUser} style={{ gap: 8 }}>
        <input
          type="email"
          placeholder="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          style={{ flex: "2 1 200px" }}
        />
        <input
          type="password"
          placeholder="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          style={{ flex: "2 1 200px" }}
        />
        <select value={role} onChange={(e) => setRole(e.target.value as UserRole)} style={{ flex: "0 0 120px" }}>
          <option value="editor">editor</option>
          <option value="admin">admin</option>
        </select>
        <button type="submit" className="primary" disabled={busy}>
          Add
        </button>
      </form>
      {error ? <div className="error">{error}</div> : null}

      <table>
        <thead>
          <tr>
            <th>Email</th>
            <th>Role</th>
            <th>Created</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.email}>
              <td>{u.email}</td>
              <td>{u.role}</td>
              <td style={{ color: "var(--muted)", fontSize: 12 }}>
                {new Date(u.createdAt).toLocaleDateString()}
              </td>
              <td>
                <button className="danger" onClick={() => void removeUser(u.email)}>
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
