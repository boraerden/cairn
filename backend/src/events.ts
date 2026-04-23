import type { ProjectEvent } from "@cairn/types";

type ProjectListener = (event: ProjectEvent) => void;

const listeners = new Map<string, Set<ProjectListener>>();

export function subscribeProject(projectId: string, listener: ProjectListener): () => void {
  const set = listeners.get(projectId) ?? new Set<ProjectListener>();
  set.add(listener);
  listeners.set(projectId, set);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(projectId);
  };
}

export function emitProjectChanged(projectId: string, cursor?: string): void {
  const event: ProjectEvent = {
    type: "project-changed",
    projectId,
    updatedAt: new Date().toISOString(),
    cursor,
  };
  for (const listener of listeners.get(projectId) ?? []) listener(event);
}
