import { useEffect, useRef, useState } from "react";
import type { Attachment } from "@cairn/types";
import { useMediaUpload } from "./useMediaUpload";

interface Props {
  featureId: string;
  onAttached: (a: Attachment) => void;
}

const MAX_AUDIO_SECONDS = 180;

function pickMime(): { mime: string; ext: string } {
  const candidates = [
    { mime: "audio/webm;codecs=opus", ext: "webm" },
    { mime: "audio/webm", ext: "webm" },
    { mime: "audio/mp4", ext: "m4a" },
  ];
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c.mime)) return c;
  }
  return { mime: "audio/webm", ext: "webm" };
}

export function AudioRecorder({ featureId, onAttached }: Props): JSX.Element {
  const enqueue = useMediaUpload();
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const timerRef = useRef<number | null>(null);
  const startedAtRef = useRef<number>(0);

  useEffect(() => () => stopStream(), []);

  function stopStream() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  async function start() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const { mime } = pickMime();
      const recorder = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        const durationMs = Date.now() - startedAtRef.current;
        const blob = new Blob(chunksRef.current, { type: mime.split(";")[0] });
        stopStream();
        setRecording(false);
        setSeconds(0);
        const attachment = await enqueue({
          featureId,
          kind: "audio",
          blob,
          mimeType: mime.split(";")[0] ?? "audio/webm",
          durationMs,
        });
        onAttached(attachment);
      };
      startedAtRef.current = Date.now();
      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
      timerRef.current = window.setInterval(() => {
        const s = Math.floor((Date.now() - startedAtRef.current) / 1000);
        setSeconds(s);
        if (s >= MAX_AUDIO_SECONDS) recorder.stop();
      }, 250);
    } catch (err) {
      alert(`Microphone error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  function stop() {
    recorderRef.current?.stop();
  }

  return (
    <button
      type="button"
      onClick={recording ? stop : start}
      className={recording ? "danger" : ""}
      aria-pressed={recording}
    >
      {recording ? `Stop · ${seconds}s` : "Audio"}
    </button>
  );
}
