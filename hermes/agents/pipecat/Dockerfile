FROM python:3.12-slim
WORKDIR /app

# Pipecat + the providers we use (Deepgram STT, ElevenLabs TTS, OpenAI LLM)
RUN pip install --no-cache-dir \
    "pipecat-ai[deepgram,elevenlabs,openai]" \
    "fastapi" \
    "uvicorn[standard]" \
    "httpx"

COPY pipelines/ /app/pipelines/
COPY server.py  /app/server.py

EXPOSE 7860
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "7860"]
