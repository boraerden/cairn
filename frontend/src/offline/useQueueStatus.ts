import { useEffect, useState } from "react";
import { subscribeQueue } from "./syncQueue";
import type { QueuedUpload } from "./db";

export function useQueueStatus(projectId?: string): QueuedUpload[] {
  const [items, setItems] = useState<QueuedUpload[]>([]);
  useEffect(() => {
    const unsub = subscribeQueue((next) =>
      setItems(projectId ? next.filter((item) => item.projectId === projectId) : next),
    );
    return unsub;
  }, [projectId]);
  return items;
}
