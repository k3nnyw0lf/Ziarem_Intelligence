/**
 * Phase 8: Multi-Agent Swarm — HTTP endpoint for discovery/health.
 * The actual WebSocket server runs separately (npm run swarm) because Next.js
 * Route Handlers cannot perform WebSocket upgrade.
 *
 * Clients should connect to: ws://<host>:3100 (or SWARM_WS_PORT).
 * Send JSON: { type: "transcript", call_id: "<vapi-call-id>", text: "<chunk>", previousContext?: string }
 */

import { NextResponse } from "next/server";

const SWARM_WS_PORT = process.env.SWARM_WS_PORT ?? "3100";

export async function GET() {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const wsHost = baseUrl.replace(/^https?:\/\//, "").split("/")[0];
  const wsUrl = `ws://${wsHost}:${SWARM_WS_PORT}`;

  return NextResponse.json({
    swarm: "Multi-Agent Whisper Engine",
    websocket_url: wsUrl,
    port: SWARM_WS_PORT,
    protocol: "JSON messages: { type: 'transcript', call_id: string, text: string, previousContext?: string }",
    agents: ["quant_agent", "underwriter_agent"],
    run: "npm run swarm",
  });
}
