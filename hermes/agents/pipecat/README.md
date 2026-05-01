# Pipecat — voice pipeline composer over Vapi/Retell

Vapi/Retell handle the SIP + low-latency audio. Pipecat composes
**what happens during the call** — language switching, sentiment-based
escalation, mid-call hand-off to Hermes for complex questions.

## Global service

In `hermes/agents/docker-compose.yml`, bound to **7860**. The
`pipecat/Dockerfile` and `pipelines/` folder hold the actual Python
pipeline definitions.

```bash
curl http://localhost:7860/health
```

## First pipeline: bilingual + escalate

`pipelines/ziarem_bilingual.py` is a starter you build out. The shape:

```python
# pipelines/ziarem_bilingual.py
from pipecat.frames import LanguageFrame, SentimentFrame
from pipecat.services import deepgram, elevenlabs
from pipecat.processors import LanguagePicker, SentimentEscalator

pipeline = [
    deepgram.STT(detect_language=True),
    LanguagePicker(map={"en": "openai-en", "es": "openai-es"}),
    HermesAsk(base_url="http://host.docker.internal:9100"),  # delegate hard Qs
    SentimentEscalator(threshold=-0.7, action="transfer_to_human"),
    elevenlabs.TTS(voice_per_language=True),
]
```

## Hand-off contract with Vapi

Vapi calls Pipecat's `/handoff` endpoint mid-call when its own LLM hits
a flag (e.g. user says "agent" or "human"). Pipecat returns either:
- a Hermes answer to inject as TTS, or
- a transfer instruction (Twilio bridge to a human extension).

## Hard rules

- Latency budget: Pipecat can add at most **300ms** before TTS. If your
  pipeline sums above that, drop a stage.
- Don't bypass Vapi for billing/legal recordings. Vapi remains the
  call-of-record; Pipecat just decorates.
- Match `preferred_language` from `leads` on the first turn. If the
  caller switches mid-call, Pipecat switches TTS voice — not just text.
