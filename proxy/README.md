# Asuka Proxy Backend

Lightweight proxy that holds API keys and forwards AI/STT/Spotify requests from distributed Electron apps.

## Setup

```bash
python -m venv .venv
.venv\Scripts\activate  # Windows
pip install -r requirements.txt
cp .env.example .env    # Fill in your keys
```

## Run (local)

```bash
python main.py
# or
uvicorn main:app --host 0.0.0.0 --port 7345
```

## Run (Docker)

```bash
cp .env.example .env   # Fill in your keys
docker compose up -d
```

## Deploy (behind reverse proxy)

Point your subdomain (e.g. `asuka-backend.yojay.space`) to port 7345 via nginx/caddy with SSL.

Example Caddy config:
```
asuka-backend.yojay.space {
    reverse_proxy localhost:7345
}
```

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/health | Health check |
| POST | /api/chat | AI chat (forwards to Gemini/Groq/OpenAI) |
| POST | /api/stt | Speech-to-text (forwards to Groq Whisper) |
| GET | /api/spotify/search?q=...&limit=5 | Spotify track search |

## Rate limiting

Default: 30 requests/minute per IP. Configure via `RATE_LIMIT` in `.env`.
