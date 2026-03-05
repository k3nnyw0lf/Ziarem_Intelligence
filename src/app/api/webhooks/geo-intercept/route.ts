/**
 * Phase 9: Physical Geo-Interception Webhook.
 * Receives POST from a mobile location provider (e.g. Radar.com) with device_id, lat, lon, timestamp.
 * Maps location to competitor geofences, matches device_id/phone to leads, pushes to high-priority intercept queue for Vapi within 15 min.
 */

import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

const COMPETITOR_GEOFENCES = [
  { name: "Competitor Mortgage Broker", lat: 26.1420, lon: -81.7948, radiusKm: 0.5 },
  { name: "Competitor Realty Office", lat: 26.1420, lon: -81.7948, radiusKm: 0.3 },
] as const;

function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function getGeofenceName(lat: number, lon: number): string | null {
  for (const g of COMPETITOR_GEOFENCES) {
    if (haversineKm(lat, lon, g.lat, g.lon) <= g.radiusKm) return g.name;
  }
  return null;
}

interface GeoPayload {
  device_id?: string;
  latitude?: number;
  longitude?: number;
  timestamp?: string;
  phone_number?: string;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as GeoPayload;
    const deviceId = body.device_id?.toString().trim();
    const lat = typeof body.latitude === "number" ? body.latitude : Number(body.latitude);
    const lon = typeof body.longitude === "number" ? body.longitude : Number(body.longitude);

    if (Number.isNaN(lat) || Number.isNaN(lon)) {
      return NextResponse.json(
        { error: "latitude and longitude required" },
        { status: 400 }
      );
    }

    const geofenceName = getGeofenceName(lat, lon);
    if (!geofenceName) {
      return NextResponse.json({ ok: true, queued: false, reason: "no_geofence_match" });
    }

    const supabase = getSupabaseAdmin();
    let leadId: string | null = null;

    if (deviceId) {
      const { data: dev } = await supabase
        .from("lead_devices")
        .select("lead_id")
        .eq("device_id", deviceId)
        .maybeSingle();
      leadId = dev?.lead_id ?? null;
    }

    if (!leadId && body.phone_number) {
      const phone = body.phone_number.toString().replace(/\D/g, "").slice(-10);
      if (phone.length >= 10) {
        const { data: lead } = await supabase
          .from("leads")
          .select("id")
          .ilike("phone_number", `%${phone.slice(-10)}`)
          .limit(1)
          .maybeSingle();
        leadId = lead?.id ?? null;
      }
    }

    if (!leadId) {
      return NextResponse.json({ ok: true, queued: false, reason: "lead_not_found" });
    }

    const scheduledBefore = new Date();
    scheduledBefore.setMinutes(scheduledBefore.getMinutes() + 15);

    const { error } = await supabase.from("intercept_queue").insert({
      lead_id: leadId,
      device_id: deviceId ?? null,
      geofence_name: geofenceName,
      latitude: lat,
      longitude: lon,
      scheduled_before_at: scheduledBefore.toISOString(),
      status: "pending",
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      queued: true,
      lead_id: leadId,
      geofence_name: geofenceName,
      scheduled_before_at: scheduledBefore.toISOString(),
    });
  } catch (e) {
    console.error("[geo-intercept]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Internal error" },
      { status: 500 }
    );
  }
}
