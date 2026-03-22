"use client";

import { useState, useCallback } from "react";
import VideoRecorder from "./VideoRecorder";
import { createClient } from "@/lib/supabase/client";

interface ComposeVideoEmailProps {
  isOpen: boolean;
  onClose: () => void;
  /** Pre-fill recipient from lead context */
  defaultRecipientEmail?: string;
  defaultRecipientName?: string;
  /** Sender info */
  senderName?: string;
  senderEmail?: string;
}

type Step = "record" | "compose" | "sending" | "sent";

export default function ComposeVideoEmail({
  isOpen,
  onClose,
  defaultRecipientEmail = "",
  defaultRecipientName = "",
  senderName = "Kenneth Wolf",
  senderEmail = "info@dosmortgage.com",
}: ComposeVideoEmailProps) {
  const [step, setStep] = useState<Step>("record");
  const [videoBlob, setVideoBlob] = useState<Blob | null>(null);
  const [thumbnailBlob, setThumbnailBlob] = useState<Blob | null>(null);
  const [durationSecs, setDurationSecs] = useState(0);

  const [recipientEmail, setRecipientEmail] = useState(defaultRecipientEmail);
  const [recipientName, setRecipientName] = useState(defaultRecipientName);
  const [subject, setSubject] = useState("Video Message from " + senderName);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sentResult, setSentResult] = useState<{ videoEmailId: string } | null>(null);

  const handleRecordingComplete = useCallback(
    (blob: Blob, thumbBlob: Blob, duration: number) => {
      setVideoBlob(blob);
      setThumbnailBlob(thumbBlob);
      setDurationSecs(duration);
      setStep("compose");
    },
    []
  );

  const handleSend = async () => {
    if (!videoBlob || !thumbnailBlob) return;
    if (!recipientEmail) {
      setError("Recipient email is required");
      return;
    }

    setStep("sending");
    setError(null);

    try {
      const supabase = createClient();
      const timestamp = Date.now();
      const videoPath = `${new Date().getFullYear()}/${String(new Date().getMonth() + 1).padStart(2, "0")}/${timestamp}.webm`;
      const thumbPath = `${new Date().getFullYear()}/${String(new Date().getMonth() + 1).padStart(2, "0")}/${timestamp}_thumb.jpg`;

      // Upload video
      const { error: videoErr } = await supabase.storage
        .from("video-emails")
        .upload(videoPath, videoBlob, {
          contentType: "video/webm",
          cacheControl: "31536000",
        });
      if (videoErr) throw new Error("Video upload failed: " + videoErr.message);

      // Upload thumbnail
      const { error: thumbErr } = await supabase.storage
        .from("video-emails")
        .upload(thumbPath, thumbnailBlob, {
          contentType: "image/jpeg",
          cacheControl: "31536000",
        });
      if (thumbErr) throw new Error("Thumbnail upload failed: " + thumbErr.message);

      // Get public URLs
      const { data: videoUrlData } = supabase.storage
        .from("video-emails")
        .getPublicUrl(videoPath);
      const { data: thumbUrlData } = supabase.storage
        .from("video-emails")
        .getPublicUrl(thumbPath);

      // Save to video_emails table
      const { data: record, error: insertErr } = await supabase
        .from("video_emails")
        .insert({
          sender_name: senderName,
          sender_email: senderEmail,
          recipient_email: recipientEmail,
          recipient_name: recipientName || null,
          subject,
          message: message || null,
          video_url: videoUrlData.publicUrl,
          thumbnail_url: thumbUrlData.publicUrl,
          video_duration_secs: durationSecs,
        })
        .select("id")
        .single();

      if (insertErr) throw new Error("Save failed: " + insertErr.message);

      // Send via API route
      const res = await fetch("/api/video-email/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoEmailId: record.id }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Send failed");
      }

      setSentResult({ videoEmailId: record.id });
      setStep("sent");
    } catch (err: any) {
      setError(err.message || "Something went wrong");
      setStep("compose");
    }
  };

  const handleClose = () => {
    setStep("record");
    setVideoBlob(null);
    setThumbnailBlob(null);
    setDurationSecs(0);
    setRecipientEmail(defaultRecipientEmail);
    setRecipientName(defaultRecipientName);
    setSubject("Video Message from " + senderName);
    setMessage("");
    setError(null);
    setSentResult(null);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-700">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-red-600 rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-white">
              {step === "record" && "Record Video"}
              {step === "compose" && "Compose Video Email"}
              {step === "sending" && "Sending..."}
              {step === "sent" && "Sent!"}
            </h2>
          </div>
          <button onClick={handleClose} className="text-zinc-400 hover:text-white transition">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="p-6">
          {/* Step indicator */}
          <div className="flex items-center gap-2 mb-6">
            {["Record", "Compose", "Send"].map((label, i) => {
              const stepIndex = step === "record" ? 0 : step === "compose" ? 1 : 2;
              const active = i <= stepIndex;
              return (
                <div key={label} className="flex items-center gap-2">
                  <div
                    className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                      active ? "bg-red-600 text-white" : "bg-zinc-700 text-zinc-400"
                    }`}
                  >
                    {i + 1}
                  </div>
                  <span className={`text-sm ${active ? "text-white" : "text-zinc-500"}`}>
                    {label}
                  </span>
                  {i < 2 && <div className="w-8 h-px bg-zinc-700" />}
                </div>
              );
            })}
          </div>

          {error && (
            <div className="bg-red-900/50 border border-red-500 text-red-200 px-4 py-2 rounded mb-4 text-sm">
              {error}
            </div>
          )}

          {/* STEP 1: Record */}
          {step === "record" && (
            <VideoRecorder
              onRecordingComplete={handleRecordingComplete}
              maxDurationSecs={120}
            />
          )}

          {/* STEP 2: Compose */}
          {step === "compose" && (
            <div className="space-y-4">
              {/* Video preview */}
              <div className="bg-black rounded-lg overflow-hidden aspect-video max-w-sm mx-auto">
                {videoBlob && (
                  <video
                    src={URL.createObjectURL(videoBlob)}
                    className="w-full h-full object-cover"
                    controls
                    playsInline
                  />
                )}
              </div>
              <p className="text-center text-zinc-400 text-sm">
                {durationSecs} second video recorded
              </p>

              {/* Email fields */}
              <div className="space-y-3">
                <div>
                  <label className="block text-sm text-zinc-400 mb-1">To (Email) *</label>
                  <input
                    type="email"
                    value={recipientEmail}
                    onChange={(e) => setRecipientEmail(e.target.value)}
                    className="w-full px-3 py-2 bg-zinc-800 border border-zinc-600 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
                    placeholder="recipient@email.com"
                  />
                </div>
                <div>
                  <label className="block text-sm text-zinc-400 mb-1">Recipient Name</label>
                  <input
                    type="text"
                    value={recipientName}
                    onChange={(e) => setRecipientName(e.target.value)}
                    className="w-full px-3 py-2 bg-zinc-800 border border-zinc-600 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
                    placeholder="John Doe"
                  />
                </div>
                <div>
                  <label className="block text-sm text-zinc-400 mb-1">Subject</label>
                  <input
                    type="text"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    className="w-full px-3 py-2 bg-zinc-800 border border-zinc-600 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm text-zinc-400 mb-1">Message (optional)</label>
                  <textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    rows={3}
                    className="w-full px-3 py-2 bg-zinc-800 border border-zinc-600 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500 resize-none"
                    placeholder="Add a personal note..."
                  />
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center justify-between pt-2">
                <button
                  onClick={() => setStep("record")}
                  className="px-4 py-2 text-sm text-zinc-400 hover:text-white transition"
                >
                  Re-record
                </button>
                <button
                  onClick={handleSend}
                  className="flex items-center gap-2 px-6 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                  </svg>
                  Send Video Email
                </button>
              </div>
            </div>
          )}

          {/* STEP 3: Sending */}
          {step === "sending" && (
            <div className="flex flex-col items-center py-12">
              <div className="w-12 h-12 border-4 border-red-600 border-t-transparent rounded-full animate-spin mb-4" />
              <p className="text-white font-medium">Uploading video & sending email...</p>
              <p className="text-zinc-400 text-sm mt-1">This may take a moment</p>
            </div>
          )}

          {/* STEP 4: Sent */}
          {step === "sent" && (
            <div className="flex flex-col items-center py-12">
              <div className="w-16 h-16 bg-green-600 rounded-full flex items-center justify-center mb-4">
                <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-white font-medium text-lg">Video Email Sent!</p>
              <p className="text-zinc-400 text-sm mt-1">
                Sent to <span className="text-white">{recipientEmail}</span>
              </p>
              <button
                onClick={handleClose}
                className="mt-6 px-6 py-2 bg-zinc-700 hover:bg-zinc-600 text-white rounded-lg transition"
              >
                Done
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
