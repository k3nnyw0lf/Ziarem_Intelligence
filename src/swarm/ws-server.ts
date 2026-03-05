/**
 * Phase 8: Multi-Agent Swarm WebSocket server.
 * Listens for transcript stream (from Vapi or n8n), runs quant_agent and underwriter_agent via Gemini,
 * and pushes system_message back to the Vapi Frontline Agent via control API.
 *
 * Run: npx tsx src/swarm/ws-server.ts   (or npm run swarm)
 * Default port: SWARM_WS_PORT=3100
 *
 * Protocol: client sends JSON messages { type: "transcript", call_id: string, text: string, previousContext?: string }
 * Server runs agents and sends to Vapi control: add-message with role "system" and the computed numbers.
 */

import { WebSocketServer } from "ws";
import { runQuantAgent } from "../lib/swarm/quantAgent";
import { runUnderwriterAgent } from "../lib/swarm/underwriterAgent";

const PORT = parseInt(process.env.SWARM_WS_PORT ?? "3100", 10);
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const VAPI_KEY = process.env.VAPI_PRIVATE_KEY ?? process.env.VAPI_API_KEY;
const VAPI_CONTROL_BASE = process.env.VAPI_CONTROL_BASE_URL ?? "https://api.vapi.ai";

interface TranscriptMessage {
  type: "transcript";
  call_id: string;
  text: string;
  previousContext?: string;
}

async function pushSystemMessageToVapi(
  callId: string,
  content: string
): Promise<boolean> {
  if (!VAPI_KEY) return false;
  const url = `${VAPI_CONTROL_BASE}/call/${callId}/control`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${VAPI_KEY}`,
    },
    body: JSON.stringify({
      type: "add-message",
      message: { role: "system", content },
      triggerResponseEnabled: false,
    }),
  });
  return res.ok;
}

const wss = new WebSocketServer({ port: PORT });

wss.on("connection", (ws) => {
  ws.on("message", async (raw) => {
    let msg: TranscriptMessage;
    try {
      msg = JSON.parse(raw.toString()) as TranscriptMessage;
    } catch {
      return;
    }
    if (msg.type !== "transcript" || !msg.call_id || !msg.text?.trim()) return;
    if (!GEMINI_KEY) {
      ws.send(JSON.stringify({ error: "GEMINI_API_KEY not set" }));
      return;
    }

    const quantPromise = runQuantAgent(
      { transcriptChunk: msg.text, previousContext: msg.previousContext },
      GEMINI_KEY
    );
    const underPromise = runUnderwriterAgent(
      { transcriptChunk: msg.text, previousContext: msg.previousContext },
      GEMINI_KEY
    );

    const [quant, under] = await Promise.all([quantPromise, underPromise]);

    if (quant.systemMessage) {
      const pushed = await pushSystemMessageToVapi(msg.call_id, quant.systemMessage);
      ws.send(
        JSON.stringify({
          agent: "quant_agent",
          systemMessage: quant.systemMessage,
          pushed,
        })
      );
    }
    if (under.systemMessage) {
      const pushed = await pushSystemMessageToVapi(msg.call_id, under.systemMessage);
      ws.send(
        JSON.stringify({
          agent: "underwriter_agent",
          systemMessage: under.systemMessage,
          pushed,
        })
      );
    }
  });
});

console.log(`[swarm] WebSocket server listening on ws://localhost:${PORT}`);
if (!GEMINI_KEY) console.warn("[swarm] GEMINI_API_KEY not set; agents will no-op");
if (!VAPI_KEY) console.warn("[swarm] VAPI_PRIVATE_KEY not set; cannot push to Vapi");
