"use client";

import { useRef, useState, useCallback, useEffect } from "react";

interface VideoRecorderProps {
  onRecordingComplete: (blob: Blob, thumbnailBlob: Blob, durationSecs: number) => void;
  maxDurationSecs?: number;
}

export default function VideoRecorder({
  onRecordingComplete,
  maxDurationSecs = 120,
}: VideoRecorderProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);

  const [status, setStatus] = useState<"idle" | "preview" | "recording" | "recorded">("idle");
  const [elapsed, setElapsed] = useState(0);
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Start camera preview
  const startCamera = useCallback(async () => {
    try {
      setError(null);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: "user" },
        audio: true,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.muted = true;
        videoRef.current.play();
      }
      setStatus("preview");
    } catch (err) {
      setError("Camera access denied. Please allow camera and microphone.");
    }
  }, []);

  // Start recording
  const startRecording = useCallback(() => {
    if (!streamRef.current) return;
    chunksRef.current = [];

    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
      ? "video/webm;codecs=vp9,opus"
      : MediaRecorder.isTypeSupported("video/webm")
      ? "video/webm"
      : "video/mp4";

    const recorder = new MediaRecorder(streamRef.current, { mimeType });
    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mimeType });
      const url = URL.createObjectURL(blob);
      setRecordedUrl(url);
      setStatus("recorded");

      // Generate thumbnail from first frame
      const thumbVideo = document.createElement("video");
      thumbVideo.src = url;
      thumbVideo.muted = true;
      thumbVideo.currentTime = 0.5;
      thumbVideo.onloadeddata = () => {
        const canvas = document.createElement("canvas");
        canvas.width = 640;
        canvas.height = 480;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(thumbVideo, 0, 0, 640, 480);
          // Draw play button overlay
          ctx.fillStyle = "rgba(0,0,0,0.4)";
          ctx.beginPath();
          ctx.arc(320, 240, 40, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#fff";
          ctx.beginPath();
          ctx.moveTo(305, 215);
          ctx.lineTo(345, 240);
          ctx.lineTo(305, 265);
          ctx.closePath();
          ctx.fill();
          // Duration badge
          const dur = Math.round(elapsed);
          ctx.fillStyle = "rgba(0,0,0,0.7)";
          ctx.fillRect(0, 440, 640, 40);
          ctx.fillStyle = "#f00";
          ctx.beginPath();
          ctx.arc(35, 460, 15, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#fff";
          ctx.beginPath();
          ctx.moveTo(30, 452);
          ctx.lineTo(42, 460);
          ctx.lineTo(30, 468);
          ctx.closePath();
          ctx.fill();
          ctx.font = "bold 16px sans-serif";
          ctx.fillStyle = "#fff";
          ctx.fillText(`Play ${dur} second video`, 60, 465);

          canvas.toBlob(
            (thumbBlob) => {
              if (thumbBlob) {
                onRecordingComplete(blob, thumbBlob, Math.round(elapsed));
              }
            },
            "image/jpeg",
            0.85
          );
        }
      };
    };

    recorder.start(1000);
    startTimeRef.current = Date.now();
    setElapsed(0);
    setStatus("recording");

    timerRef.current = setInterval(() => {
      const secs = (Date.now() - startTimeRef.current) / 1000;
      setElapsed(secs);
      if (secs >= maxDurationSecs) {
        stopRecording();
      }
    }, 100);
  }, [maxDurationSecs, onRecordingComplete, elapsed]);

  // Stop recording
  const stopRecording = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    // Stop all tracks
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  // Re-record
  const reRecord = useCallback(() => {
    if (recordedUrl) URL.revokeObjectURL(recordedUrl);
    setRecordedUrl(null);
    setElapsed(0);
    setStatus("idle");
  }, [recordedUrl]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
      if (timerRef.current) clearInterval(timerRef.current);
      if (recordedUrl) URL.revokeObjectURL(recordedUrl);
    };
  }, []);

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <div className="w-full max-w-[640px] mx-auto">
      {error && (
        <div className="bg-red-900/50 border border-red-500 text-red-200 px-4 py-2 rounded mb-3 text-sm">
          {error}
        </div>
      )}

      {/* Video display */}
      <div className="relative bg-black rounded-lg overflow-hidden aspect-[4/3]">
        {status === "idle" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-zinc-400">
            <svg className="w-16 h-16 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
            </svg>
            <p className="text-sm">Click below to start your camera</p>
          </div>
        )}

        {(status === "preview" || status === "recording") && (
          <video
            ref={videoRef}
            className="w-full h-full object-cover"
            playsInline
            muted
            style={{ transform: "scaleX(-1)" }}
          />
        )}

        {status === "recorded" && recordedUrl && (
          <video
            src={recordedUrl}
            className="w-full h-full object-cover"
            controls
            playsInline
          />
        )}

        {/* Recording indicator */}
        {status === "recording" && (
          <div className="absolute top-3 left-3 flex items-center gap-2 bg-black/60 px-3 py-1.5 rounded-full">
            <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
            <span className="text-white text-sm font-mono">{formatTime(elapsed)}</span>
            <span className="text-zinc-400 text-xs">/ {formatTime(maxDurationSecs)}</span>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="flex items-center justify-center gap-3 mt-4">
        {status === "idle" && (
          <button
            onClick={startCamera}
            className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
            </svg>
            Start Camera
          </button>
        )}

        {status === "preview" && (
          <button
            onClick={startRecording}
            className="flex items-center gap-2 px-6 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition"
          >
            <div className="w-4 h-4 bg-white rounded-full" />
            Start Recording
          </button>
        )}

        {status === "recording" && (
          <button
            onClick={stopRecording}
            className="flex items-center gap-2 px-6 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition animate-pulse"
          >
            <div className="w-4 h-4 bg-white rounded" />
            Stop Recording
          </button>
        )}

        {status === "recorded" && (
          <button
            onClick={reRecord}
            className="flex items-center gap-2 px-5 py-2 bg-zinc-700 hover:bg-zinc-600 text-white rounded-lg font-medium transition"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
            </svg>
            Re-record
          </button>
        )}
      </div>
    </div>
  );
}
