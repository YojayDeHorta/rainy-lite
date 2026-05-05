# AGENTS.md

## What this is

Rainy Lite — a Windows-first desktop AI companion. Electron frontend (two windows: floating avatar + chat panel) with a local FastAPI backend for AI, TTS, STT, and memory.

## Commands

```bash
npm run dev            # Start Electron (auto-spawns backend on 127.0.0.1:8765)
npm run backend        # Start backend only (Linux/macOS)
npm run backend:win    # Start backend only (Windows)
```

No test suite, no linter, no formatter configured. Verify changes with:
- `node --check app/main/main.js` — JS syntax
- `.venv/bin/python -c "import py_compile; py_compile.compile('backend/FILE.py', doraise=True)"` — Python syntax

## Setup

```bash
python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt
npm install
cp .env.example .env   # then fill in API keys
```

Windows: use `python` instead of `python3`, `.venv\Scripts\activate`.

## Architecture

```
app/main/main.js       → Electron main process (windows, IPC, system actions, backend spawn)
app/main/preload.js    → contextBridge exposing rainyDesktop.* APIs
app/renderer/
  avatar.html/css      → Transparent floating avatar window (VRM + Three.js)
  avatar-vrm.js        → VRM loader, idle pose, expressions, cursor tracking, lip sync
  avatar-window.js     → Avatar renderer orchestration, TTS playback
  index.html           → Chat window UI
  renderer.js          → Chat logic, action parsing, auto-execution
  styles.css           → Chat panel styles
backend/
  main.py              → FastAPI: /api/chat, /api/tts, /api/stt, /api/memory, /api/spotify/search
  ai_core.py           → Multi-provider AI (gemini, groq, openai, ollama)
  config.py            → Loads .env, exposes all settings as module constants
  prompts.py           → System prompt with emotion tags + action allowlist
  spotify.py           → Spotify Web API client credentials + track search
  tts.py               → edge-tts synthesis
  stt.py               → Groq Whisper transcription
  memory.py            → SQLite chat history + memory
assets/rainy.vrm       → VRM model file (currently a copy of Asuka's model)
```

## Key facts

- **Backend auto-starts** from Electron main process using `.venv` Python. Don't run it separately unless debugging.
- **Backend Python files** use relative imports (`from . import config`), so they must be run as a module: `python -m uvicorn backend.main:app`.
- **Two separate Electron windows**: avatar (transparent, frameless, always-on-top) and chat (opaque `#070b13`, frameless, 540x720).
- **All UI is in Spanish.** The system prompt, responses, error messages, and TTS voice are all Spanish.
- **Avatar window is intentionally clean.** No backgrounds, no text bubbles, no rain effects. Only the VRM model visible.
- **Actions execute without confirmation.** The AI outputs `[ACTION: TYPE "payload"]` tags; the renderer parses and auto-executes them via IPC to main process.
- **Allowed action types** are defined in `backend/prompts.py` (the AI prompt) and handled in `app/main/main.js:executeAction()`. Both must stay in sync.
- **Spotify** uses Web API (Client Credentials flow, no user OAuth). Credentials go in `.env`. Searches return track URIs like `spotify:track:ID` which are opened via `shell.openExternal`.
- **Media keys** on Windows use PowerShell + `user32.dll keybd_event`. On macOS uses AppleScript to Spotify. On Linux uses `playerctl`.
- **VRM loading** uses Three.js importmap in avatar.html. If `assets/rainy.vrm` is missing, a CSS fallback renders instead.
- **Window dragging** is custom IPC-based (pointer events → `window:get-position`/`window:set-position`), not CSS `-webkit-app-region: drag`, because drag regions block pointer events needed for VRM interaction.
- **Global cursor tracking** polls `screen.getCursorScreenPoint()` at 30fps and sends to avatar window for head/neck motion.

## Conventions

- No code comments unless explicitly requested by user.
- PowerShell scripts on Windows use `-EncodedCommand` with Base64 UTF-16LE encoding to avoid quote escaping and CMD flashing.
- Action handling: main.js dispatches by `type` string (uppercase), payload is always a string.
- Config values are read once at import from `config.py`; changing `.env` requires backend restart.

## Gotchas

- `.venv/` is not committed. The Electron app checks for `.venv` Python first, falls back to system `python`/`python3`.
- `temp/` stores TTS audio files served via FastAPI static mount at `/temp/`. Cleared on restart (in gitignore).
- `data/*.sqlite` is in gitignore — local DB is ephemeral per machine.
- The VRM model at `assets/rainy.vrm` is a placeholder (Asuka's model). Don't commit changes to it lightly.
- `requests` library is used in backend for Spotify API (already in requirements.txt). Don't add `httpx` or `aiohttp`.
