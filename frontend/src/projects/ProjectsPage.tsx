import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import type { CreateProjectRequest, ProjectMemberRequest, ProjectSummary } from "@cairn/types";
import { api, ApiError } from "../api";
import { useAuth } from "../auth/AuthProvider";

export const LAST_PROJECT_KEY = "cairn.lastProjectId";

export function rememberLastProject(projectId: string): void {
  try {
    localStorage.setItem(LAST_PROJECT_KEY, projectId);
  } catch {
    // ignore storage failures in private browsing
  }
}

function readLastProject(): string | null {
  try {
    return localStorage.getItem(LAST_PROJECT_KEY);
  } catch {
    return null;
  }
}

export function ProjectLandingPage(): JSX.Element {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void (async () => {
      try {
        const projects = await api<ProjectSummary[]>("GET", "/projects");
        if (cancelled) return;
        const remembered = readLastProject();
        const selected =
          projects.find((project) => project.id === remembered) ??
          [...projects].sort(compareLastOpened)[0] ??
          null;
        if (selected) {
          rememberLastProject(selected.id);
          navigate(`/projects/${selected.id}/map`, { replace: true });
        } else {
          navigate("/projects", { replace: true });
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : String(err));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate, user]);

  if (!user) return <Navigate to="/login" replace />;
  if (error) {
    return (
      <div className="login-shell">
        <div className="login-card">
          <h1>Cairn</h1>
          <div className="error">{error}</div>
          <Link to="/projects">Go to projects</Link>
        </div>
      </div>
    );
  }
  return (
    <div className="login-shell">
      <div className="login-card">
        <h1>Cairn</h1>
        <p style={{ margin: 0, color: "var(--muted)" }}>Opening your last project…</p>
      </div>
    </div>
  );
}

export function ProjectsPage(): JSX.Element {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [memberDrafts, setMemberDrafts] = useState<Record<string, string>>({});

  const loadProjects = useCallback(async () => {
    try {
      const items = await api<ProjectSummary[]>("GET", "/projects");
      setProjects(items.sort(compareLastOpened));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  const lastOpened = useMemo(() => projects[0] ?? null, [projects]);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const project = await api<ProjectSummary>("POST", "/projects", {
        body: { name } satisfies CreateProjectRequest,
      });
      rememberLastProject(project.id);
      navigate(`/projects/${project.id}/map`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function openProject(projectId: string) {
    try {
      await api<ProjectSummary>("POST", `/projects/${encodeURIComponent(projectId)}/open`);
      rememberLastProject(projectId);
      navigate(`/projects/${projectId}/map`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }

  async function addMember(projectId: string) {
    const email = memberDrafts[projectId]?.trim();
    if (!email) return;
    setError(null);
    try {
      await api<ProjectSummary>("POST", `/projects/${encodeURIComponent(projectId)}/members`, {
        body: { email } satisfies ProjectMemberRequest,
      });
      setMemberDrafts((prev) => ({ ...prev, [projectId]: "" }));
      await loadProjects();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }

  async function removeMember(projectId: string, email: string) {
    if (!confirm(`Remove ${email} from this project?`)) return;
    setError(null);
    try {
      await api<ProjectSummary>("DELETE", `/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(email)}`);
      await loadProjects();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }

  return (
    <div className="admin-shell">
      <div className="row">
        <h1 style={{ margin: 0 }}>Projects</h1>
        <div style={{ flex: 1 }} />
        {user?.role === "admin" ? (
          <Link to="/admin">
            <button type="button">Admin</button>
          </Link>
        ) : null}
        {lastOpened ? (
          <button type="button" onClick={() => void openProject(lastOpened.id)}>
            Open last project
          </button>
        ) : null}
        <button type="button" onClick={logout}>
          Sign out
        </button>
      </div>

      <form className="row" onSubmit={create}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Create a new project"
          required
          style={{ flex: "1 1 260px" }}
        />
        <button type="submit" className="primary" disabled={busy}>
          {busy ? "Creating…" : "Create project"}
        </button>
      </form>
      {error ? <div className="error">{error}</div> : null}

      <div className="project-grid">
        {projects.map((project) => (
          <section key={project.id} className="project-card">
            <div className="row" style={{ alignItems: "flex-start" }}>
              <div style={{ flex: 1 }}>
                <h2 style={{ margin: "0 0 4px" }}>{project.name}</h2>
                <div style={{ color: "var(--muted)", fontSize: 13 }}>
                  Updated {new Date(project.updatedAt).toLocaleString()}
                  {project.lastOpenedAt ? ` · opened ${new Date(project.lastOpenedAt).toLocaleString()}` : ""}
                </div>
              </div>
              <button type="button" className="primary" onClick={() => void openProject(project.id)}>
                Open
              </button>
            </div>

            <div className="field-row">
              <label>Members</label>
              <div className="project-members">
                {project.memberEmails.map((email) => (
                  <div key={email} className="project-member-chip">
                    <span>{email}</span>
                    {project.canManageMembers && email !== project.createdBy ? (
                      <button
                        type="button"
                        className="danger"
                        onClick={() => void removeMember(project.id, email)}
                        style={{ minHeight: 28, padding: "2px 8px" }}
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>

            {project.canManageMembers ? (
              <div className="row">
                <input
                  value={memberDrafts[project.id] ?? ""}
                  onChange={(e) => setMemberDrafts((prev) => ({ ...prev, [project.id]: e.target.value }))}
                  placeholder="Add member by email"
                  style={{ flex: "1 1 240px" }}
                />
                <button type="button" onClick={() => void addMember(project.id)}>
                  Add member
                </button>
              </div>
            ) : null}
          </section>
        ))}
      </div>
    </div>
  );
}

function compareLastOpened(a: ProjectSummary, b: ProjectSummary): number {
  const aTime = a.lastOpenedAt ?? a.updatedAt;
  const bTime = b.lastOpenedAt ?? b.updatedAt;
  return bTime.localeCompare(aTime) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}
