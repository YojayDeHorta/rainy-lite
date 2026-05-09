# AGENTS.md

## What this is

Rainy Lite — a Windows-first desktop AI companion. Electron frontend (two windows: floating avatar + chat panel) with a local FastAPI backend for TTS and memory, and a remote proxy backend for AI, STT, and Spotify.

## Commands

```bash
npm run dev            # Start Electron (auto-spawns local backend on 127.0.0.1:8765)
npm run backend        # Start local backend only (Linux/macOS)
npm run backend:win    # Start local backend only (Windows)
```

No test suite, no linter, no formatter configured. Verify changes with:
- `node --check app/main/main.js` — JS syntax
- `.venv/bin/python -c "import py_compile; py_compile.compile('backend/FILE.py', doraise=True)"` — Python syntax

## Setup (local dev)

```bash
python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt
npm install
cp .env.example .env   # fill in PROXY_URL and PROXY_SECRET
```

Windows: use `python` instead of `python3`, `.venv\Scripts\activate`.

## Setup (proxy server)

```bash
cd proxy/
cp .env.example .env   # fill in API keys + API_SECRET
docker compose up -d   # runs on port 7345
```

## Architecture

```
app/main/main.js       → Electron main process (windows, IPC, system actions, backend spawn)
app/main/preload.js    → contextBridge exposing rainyDesktop.* APIs
app/renderer/
  avatar.html/css      → Transparent floating avatar window (VRM + Three.js)
  avatar-vrm.js        → VRM loader, idle pose, expressions, cursor tracking, lip sync, dance routines
  avatar-window.js     → Avatar renderer orchestration, TTS playback, Spotify track change detection
  index.html           → Chat window UI
  renderer.js          → Chat logic, action parsing, auto-execution
  styles.css           → Chat panel styles
backend/                 (local — runs inside the Electron app)
  main.py              → FastAPI: /api/chat, /api/tts, /api/stt, /api/memory, /api/spotify/search
  ai_core.py           → AI routing: local providers OR proxy forwarding via PROXY_URL
  config.py            → Loads .env, exposes all settings as module constants
  prompts.py           → System prompt with emotion tags + action allowlist
  spotify.py           → Spotify search: local OR proxy forwarding via PROXY_URL
  tts.py               → edge-tts synthesis (always local, no key needed)
  stt.py               → STT: local Groq Whisper OR proxy forwarding via PROXY_URL
  memory.py            → SQLite chat history + memory (always local)
proxy/                   (remote — deployed on your server)
  main.py              → FastAPI proxy: /api/chat, /api/stt, /api/spotify/search
  config.py            → Loads .env with API keys + API_SECRET
  Dockerfile           → Python 3.12 slim, port 7345
  docker-compose.yml   → Docker deploy config
  requirements.txt     → Proxy-specific dependencies (includes slowapi for rate limiting)
assets/rainy.vrm       → VRM model file (currently a copy of Asuka's model)
```

## Proxy mode

When `PROXY_URL` is set in the local `.env`, the local backend forwards AI chat, STT, and Spotify search to the remote proxy instead of calling APIs directly. TTS and memory always stay local.

```
Electron app → local backend (:8765) → proxy (asuka-backend.yojay.space:7345) → Gemini/Groq/Spotify APIs
                    ↓
              TTS + memory (local, no keys needed)
```

Authentication: the local backend sends `X-Api-Key` header with `PROXY_SECRET`; the proxy validates it against `API_SECRET`. Requests without a valid key get 403.

## Key facts

- **Backend auto-starts** from Electron main process using `.venv` Python. Don't run it separately unless debugging.
- **Backend Python files** use relative imports (`from . import config`), so they must be run as a module: `python -m uvicorn backend.main:app`.
- **Two separate Electron windows**: avatar (transparent, frameless, always-on-top) and chat (opaque `#070b13`, frameless, 540x720).
- **All UI is in Spanish.** The system prompt, responses, error messages, and TTS voice are all Spanish.
- **Avatar window is intentionally clean.** No backgrounds, no text bubbles, no rain effects. Only the VRM model visible.
- **Actions execute without confirmation.** The AI outputs `[ACTION: TYPE "payload"]` tags; the renderer parses and auto-executes them via IPC to main process.
- **Allowed action types** are defined in `backend/prompts.py` (the AI prompt) and handled in `app/main/main.js:executeAction()`. Both must stay in sync.
- **Spotify** uses Web API (Client Credentials flow, no user OAuth). In proxy mode, credentials live on the server only. Searches return track URIs like `spotify:track:ID` which are opened via `shell.openExternal`.
- **Spotify track detection**: main.js polls the Spotify window title via PowerShell. When the title changes (new song), it sends `rainy:spotify-track-changed` IPC to the avatar window, which cycles the dance routine.
- **Dance routines**: 3 routines (sway, bounce, groove) defined in `avatar-vrm.js` as `danceRoutines[]`. They rotate sequentially via `currentDanceIndex` each time the avatar enters 'dancing' state or the Spotify track changes.
- **Media keys** on Windows use PowerShell + `user32.dll keybd_event`. On macOS uses AppleScript to Spotify. On Linux uses `playerctl`.
- **VRM loading** uses Three.js importmap in avatar.html. If `assets/rainy.vrm` is missing, a CSS fallback renders instead.
- **Window dragging** is custom IPC-based (pointer events → `window:get-position`/`window:set-position`), not CSS `-webkit-app-region: drag`, because drag regions block pointer events needed for VRM interaction.
- **Global cursor tracking** polls `screen.getCursorScreenPoint()` at 30fps and sends to avatar window for head/neck motion.

## Conventions

- No code comments unless explicitly requested by user.
- PowerShell scripts on Windows use `-EncodedCommand` with Base64 UTF-16LE encoding to avoid quote escaping and CMD flashing.
- Action handling: main.js dispatches by `type` string (uppercase), payload is always a string.
- Config values are read once at import from `config.py`; changing `.env` requires backend restart.
- `requests` library is used in backend for proxy forwarding and Spotify API. Don't add `httpx` or `aiohttp`.

## Gotchas

- `.venv/` is not committed. The Electron app checks for `.venv` Python first, falls back to system `python`/`python3`.
- `temp/` stores TTS audio files served via FastAPI static mount at `/temp/`. Cleared on restart (in gitignore).
- `data/*.sqlite` is in gitignore — local DB is ephemeral per machine.
- The VRM model at `assets/rainy.vrm` is a placeholder (Asuka's model). Don't commit changes to it lightly.
- `proxy/.env` is gitignored — API keys live only on the server, never in the distributed app.
- Without `PROXY_URL`, the local backend falls back to using local API keys from `.env` (dev mode).
