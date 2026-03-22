import { createClient } from "@supabase/supabase-js";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

// Server component — fetches video email and renders player
async function getVideoEmail(id: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;

  const supabase = createClient(url, key);

  const { data, error } = await supabase
    .from("video_emails")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data) return null;

  // Increment views
  await supabase
    .from("video_emails")
    .update({
      views: (data.views || 0) + 1,
      first_viewed_at: data.first_viewed_at || new Date().toISOString(),
    })
    .eq("id", id);

  return data;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const ve = await getVideoEmail(id);
  if (!ve) return { title: "Video Not Found" };

  return {
    title: `Video from ${ve.sender_name}`,
    description: ve.message || `${ve.sender_name} sent you a ${ve.video_duration_secs}s video message`,
    openGraph: {
      title: `Video from ${ve.sender_name}`,
      description: ve.message || `Watch this ${ve.video_duration_secs}s video message`,
      images: ve.thumbnail_url ? [{ url: ve.thumbnail_url, width: 640, height: 480 }] : [],
      type: "video.other",
    },
  };
}

export default async function VideoViewerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return notFound();

  const supabase = createClient(url, key);
  const { data: ve, error } = await supabase
    .from("video_emails")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !ve) return notFound();

  // Update views
  await supabase
    .from("video_emails")
    .update({
      views: (ve.views || 0) + 1,
      first_viewed_at: ve.first_viewed_at || new Date().toISOString(),
    })
    .eq("id", id);

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center p-4">
      {/* Branding */}
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-bold text-white mb-1">
          Video from {ve.sender_name}
        </h1>
        <p className="text-zinc-400 text-sm">
          {ve.video_duration_secs} second video message
        </p>
      </div>

      {/* Video Player */}
      <div className="w-full max-w-2xl bg-black rounded-xl overflow-hidden shadow-2xl">
        <video
          src={ve.video_url}
          controls
          autoPlay
          playsInline
          poster={ve.thumbnail_url || undefined}
          className="w-full aspect-[4/3] object-cover"
        />
      </div>

      {/* Message */}
      {ve.message && (
        <div className="w-full max-w-2xl mt-6 bg-zinc-900 border border-zinc-800 rounded-xl p-5">
          <p className="text-zinc-300 text-sm leading-relaxed whitespace-pre-wrap">
            {ve.message}
          </p>
        </div>
      )}

      {/* Sender info */}
      <div className="mt-6 text-center">
        <div className="inline-flex items-center gap-3 bg-zinc-900 border border-zinc-800 rounded-full px-5 py-2.5">
          <div className="w-8 h-8 bg-red-600 rounded-full flex items-center justify-center text-white text-xs font-bold">
            {ve.sender_name
              .split(" ")
              .map((n: string) => n[0])
              .join("")
              .slice(0, 2)
              .toUpperCase()}
          </div>
          <div className="text-left">
            <p className="text-white text-sm font-medium">{ve.sender_name}</p>
            <p className="text-zinc-400 text-xs">{ve.sender_email}</p>
          </div>
        </div>
      </div>

      {/* Footer */}
      <p className="mt-8 text-zinc-600 text-xs">
        Powered by{" "}
        <a
          href="https://ziarem.com"
          className="text-red-500 hover:text-red-400 transition"
        >
          Ziarem
        </a>
      </p>
    </div>
  );
}
