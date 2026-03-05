/**
 * Fetch recording from Vapi (temporary URL), upload to Supabase Storage
 * (call-recordings bucket), return permanent public URL for calls.recording_url.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";

const BUCKET = "call-recordings";

function getExtension(url: string): string {
  try {
    const path = new URL(url).pathname;
    if (path.toLowerCase().endsWith(".wav")) return "wav";
    if (path.toLowerCase().endsWith(".mp3")) return "mp3";
    if (path.toLowerCase().endsWith(".webm")) return "webm";
    if (path.toLowerCase().endsWith(".mp4")) return "mp4";
  } catch {
    // ignore
  }
  return "wav";
}

/**
 * Fetch raw audio from Vapi URL, upload to call-recordings bucket, return public URL.
 * Returns null on any failure (caller can keep original URL as fallback).
 */
export async function uploadRecordingToStorage(
  vapiRecordingUrl: string,
  callId: string
): Promise<string | null> {
  let buffer: ArrayBuffer;
  try {
    const res = await fetch(vapiRecordingUrl, {
      headers: { Accept: "audio/*" },
    });
    if (!res.ok) {
      console.warn("[storage] fetch recording failed:", res.status, vapiRecordingUrl);
      return null;
    }
    buffer = await res.arrayBuffer();
  } catch (e) {
    console.warn("[storage] fetch recording error:", e);
    return null;
  }

  const ext = getExtension(vapiRecordingUrl);
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const path = `${year}/${month}/${callId}.${ext}`;

  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(path, buffer, {
      contentType: ext === "wav" ? "audio/wav" : ext === "mp3" ? "audio/mpeg" : `audio/${ext}`,
      upsert: true,
    });

  if (error) {
    console.warn("[storage] upload failed:", error);
    return null;
  }

  const { data: urlData } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(data.path);
  return urlData?.publicUrl ?? null;
}
