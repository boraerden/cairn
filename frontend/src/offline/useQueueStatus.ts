import { useEffect, useState } from "react";
import { subscribeQueue } from "./syncQueue";
import type { QueuedUpload } from "./db";

export function useQueueStatus(): QueuedUpload[] {
  const [items, setItems] = useState<QueuedUpload[]>([]);
  useEffect(() => {
    const unsub = subscribeQueue(setItems);
    return unsub;
  }, []);
  return items;
}
