import { randomUUID } from "node:crypto";
import type { ProjectRecord, ProjectSummary } from "@cairn/types";
import { S3_KEYS } from "./env.js";
import { getObjectText, putObjectText } from "./s3.js";

export async function loadProjects(): Promise<{ projects: ProjectRecord[]; etag: string | null }> {
  const obj = await getObjectText(S3_KEYS.projects);
  if (!obj) return { projects: [], etag: null };
  const parsed = JSON.parse(obj.body) as ProjectRecord[];
  return { projects: parsed, etag: obj.etag };
}

export async function saveProjects(projects: ProjectRecord[]): Promise<void> {
  await putObjectText(S3_KEYS.projects, JSON.stringify(projects, null, 2));
}

export function summarizeProject(project: ProjectRecord, email: string): ProjectSummary {
  return {
    id: project.id,
    name: project.name,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    createdBy: project.createdBy,
    memberEmails: [...project.memberEmails].sort((a, b) => a.localeCompare(b)),
    lastOpenedAt: project.lastOpenedBy[email] ?? null,
    canManageMembers: sameEmail(project.createdBy, email),
  };
}

export async function listProjectsForUser(email: string): Promise<ProjectSummary[]> {
  const { projects } = await loadProjects();
  return projects
    .filter((project) => hasProjectAccess(project, email))
    .map((project) => summarizeProject(project, email))
    .sort(compareProjects);
}

export async function getProjectById(projectId: string): Promise<ProjectRecord | undefined> {
  const { projects } = await loadProjects();
  return projects.find((project) => project.id === projectId);
}

export async function createProject(name: string, creatorEmail: string): Promise<ProjectRecord> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("project name required");
  const { projects } = await loadProjects();
  const now = new Date().toISOString();
  const project: ProjectRecord = {
    id: randomUUID(),
    name: trimmed,
    createdAt: now,
    updatedAt: now,
    createdBy: creatorEmail,
    memberEmails: [creatorEmail],
    lastOpenedBy: { [creatorEmail]: now },
  };
  await saveProjects([...projects, project]);
  return project;
}

export async function updateProjectMembers(
  projectId: string,
  actorEmail: string,
  updater: (project: ProjectRecord) => ProjectRecord,
): Promise<ProjectRecord> {
  const { projects } = await loadProjects();
  const index = projects.findIndex((project) => project.id === projectId);
  if (index === -1) throw new Error("project not found");
  const current = projects[index]!;
  if (!sameEmail(current.createdBy, actorEmail)) {
    throw new Error("forbidden");
  }
  const next = updater(current);
  const updated: ProjectRecord = { ...next, updatedAt: new Date().toISOString() };
  const copy = [...projects];
  copy[index] = updated;
  await saveProjects(copy);
  return updated;
}

export async function addProjectMember(
  projectId: string,
  actorEmail: string,
  memberEmail: string,
): Promise<ProjectRecord> {
  const email = normalizeEmail(memberEmail);
  if (!email) throw new Error("member email required");
  return updateProjectMembers(projectId, actorEmail, (project) => ({
    ...project,
    memberEmails: project.memberEmails.some((value) => sameEmail(value, email))
      ? project.memberEmails
      : [...project.memberEmails, email],
  }));
}

export async function removeProjectMember(
  projectId: string,
  actorEmail: string,
  memberEmail: string,
): Promise<ProjectRecord> {
  const email = normalizeEmail(memberEmail);
  if (!email) throw new Error("member email required");
  return updateProjectMembers(projectId, actorEmail, (project) => {
    if (sameEmail(project.createdBy, email)) {
      throw new Error("cannot remove project creator");
    }
    const memberEmails = project.memberEmails.filter((value) => !sameEmail(value, email));
    if (memberEmails.length === 0) throw new Error("project must have at least one member");
    const lastOpenedBy = { ...project.lastOpenedBy };
    delete lastOpenedBy[email];
    return { ...project, memberEmails, lastOpenedBy };
  });
}

export async function markProjectOpened(projectId: string, email: string): Promise<ProjectRecord> {
  const { projects } = await loadProjects();
  const index = projects.findIndex((project) => project.id === projectId);
  if (index === -1) throw new Error("project not found");
  const project = projects[index]!;
  if (!hasProjectAccess(project, email)) throw new Error("forbidden");
  const now = new Date().toISOString();
  const updated: ProjectRecord = {
    ...project,
    updatedAt: project.updatedAt,
    lastOpenedBy: { ...project.lastOpenedBy, [email]: now },
  };
  const copy = [...projects];
  copy[index] = updated;
  await saveProjects(copy);
  return updated;
}

export async function touchProject(projectId: string): Promise<void> {
  const { projects } = await loadProjects();
  const index = projects.findIndex((project) => project.id === projectId);
  if (index === -1) throw new Error("project not found");
  const copy = [...projects];
  copy[index] = { ...copy[index]!, updatedAt: new Date().toISOString() };
  await saveProjects(copy);
}

export function hasProjectAccess(project: ProjectRecord, email: string): boolean {
  return project.memberEmails.some((value) => sameEmail(value, email));
}

export async function requireProjectAccess(projectId: string, email: string): Promise<ProjectRecord> {
  const project = await getProjectById(projectId);
  if (!project) throw new Error("project not found");
  if (!hasProjectAccess(project, email)) throw new Error("forbidden");
  return project;
}

function compareProjects(a: ProjectSummary, b: ProjectSummary): number {
  const aTime = a.lastOpenedAt ?? a.updatedAt;
  const bTime = b.lastOpenedAt ?? b.updatedAt;
  if (aTime !== bTime) return bTime.localeCompare(aTime);
  return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}

function sameEmail(a: string, b: string): boolean {
  return normalizeEmail(a) === normalizeEmail(b);
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}
