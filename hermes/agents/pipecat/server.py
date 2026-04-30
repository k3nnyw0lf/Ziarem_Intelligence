"""Pipecat HTTP server — exposes /health, /handoff, /mcp.

Vapi calls /handoff mid-call with the user's last utterance + call
metadata; we run the pipeline and return either a TTS answer (to inject)
or a transfer instruction. Hermes calls /mcp via the registered MCP URL.

This is a starter — extend pipelines/ and route here.
"""
from __future__ import annotations

import os
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

app = FastAPI(title="Ziarem Pipecat")


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/handoff")
async def handoff(req: Request) -> JSONResponse:
    payload = await req.json()
    # payload shape (Vapi):
    #   { call_id, lead_id, language, last_utterance, sentiment }
    # Replace with your real pipeline dispatch:
    return JSONResponse({
        "action": "tts",
        "language": payload.get("language", "en"),
        "text": "One moment, let me check that for you.",
    })


@app.get("/mcp")
async def mcp_descriptor() -> dict[str, object]:
    """Minimal MCP descriptor so `hermes mcp add pipecat ...` finds the
    right tool surface. Replace with the full MCP handshake when you
    promote this to production."""
    return {
        "name": "pipecat",
        "version": "0.1.0",
        "tools": [
            {"name": "voice.handoff", "description": "Inject a TTS answer mid-call"},
            {"name": "voice.transfer", "description": "Bridge call to a human extension"},
        ],
    }
