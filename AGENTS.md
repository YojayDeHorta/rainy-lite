# AGENTS.md

## What this is

Asuka Desktop — a Windows-first Electron desktop AI companion. It has a local FastAPI backend for TTS, memory, wake word, and local orchestration, plus an optional remote `proxy/` backend for AI, STT, and Spotify so distributed builds do not ship API keys.

## Commands

```bash
npm run dev            # Start Electron; Electron auto-spawns local backend on 127.0.0.1:8765
npm run backend        # Start local backend only (Linux/macOS)
npm run backend:win    # Start local backend only (Windows)
npm run dist:portable  # Build Windows portable app with electron-builder
```

No test suite, linter, or formatter is configured. Focused verification:
- `node --check app/main/main.js`
- `node --check app/renderer/renderer.js`
- `node --check app/renderer/settings.js`
- `node --check app/renderer/setup.js`
- `.venv/bin/python -c "import py_compile, glob; [py_compile.compile(f, doraise=True) for f in glob.glob('backend/*.py') + glob.glob('proxy/*.py')]"`

## Setup

```bash
python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt
npm install
cp .env.example .env   # recommended: fill PROXY_URL and PROXY_SECRET
```

Windows: use `python` instead of `python3`, and `.venv\Scripts\activate`.

Proxy server setup:

```bash
cd proxy/
cp .env.example .env   # fill API keys + API_SECRET
```

## Architecture

```
app/main/main.js       -> Electron main: windows, tray icon, setup/profile, IPC, system actions, backend spawn, Spotify monitor
                        and Discord Rich Presence lifecycle
app/main/preload.js    -> contextBridge exposing window.rainyDesktop.* APIs
app/renderer/index.html + renderer.js
                        -> chat UI, voice recording, endpointing, wake-word polling, action parsing
app/renderer/avatar.*  -> transparent avatar window, VRM animation, lip sync, wake-word indicator, Spotify dancing
app/renderer/settings.*-> settings window: theme, mic, personality, memory/sessions, avatar pose/model, TTS prefs
                        and integrations toggles
app/renderer/setup.*   -> first-run setup: bot/user names, personality, VRM model preview
app/renderer/setup-vrm-preview.js
                        -> shared Three.js/VRM preview used by setup/settings
backend/               -> local FastAPI backend, spawned by Electron
  main.py              -> /api/chat, /api/tts, /api/stt, /api/memory, /api/spotify/search, wakeword endpoints
  ai_core.py           -> local providers OR proxy forwarding via PROXY_URL
  config.py            -> .env loading; supports RAINY_ENV_PATH and RAINY_USER_DATA_DIR
  prompts.py           -> bot/personality prompt, emotion tags, action allowlist, conversation-control format
  spotify.py           -> local Spotify API OR proxy forwarding
  stt.py               -> local Groq Whisper OR proxy forwarding
  tts.py               -> edge-tts synthesis, always local
  wakeword.py          -> OpenWakeWord listener, diagnostics, input-device selection
  temp_cleanup.py      -> sweeps old tts_*/stt_* files from temp
  memory.py            -> SQLite chat sessions, messages, summaries, and memory, always local
proxy/                 -> remote FastAPI proxy for deployed/distributed builds
  main.py              -> /api/chat, /api/stt, /api/spotify/search with API-secret auth + rate limiting
  config.py            -> proxy .env settings and API keys
  Dockerfile           -> Python 3.12 slim, port 7345
  docker-compose.yml   -> container name asuka-proxy, binds 0.0.0.0:7345
assets/models/*.vrm    -> bundled VRM models; user-uploaded VRMs live in Electron userData/models
assets/wakeword/*.onnx -> bundled wake-word models
```

## Runtime Flow

- First run opens `setup.html` instead of chat/avatar until `profile.json` has `setupCompleted: true`.
- Normal UI has separate windows: avatar (transparent, frameless, always-on-top) and chat (opaque, frameless, initially hidden).
- Electron auto-spawns backend with `python -m uvicorn backend.main:app --host 127.0.0.1 --port 8765`.
- Packaged builds use `process.resourcesPath/app.asar.unpacked` for backend files and pass `RAINY_USER_DATA_DIR` plus `RAINY_ENV_PATH` to backend. `package.json` currently copies root `.env` next to the portable `.exe` via `build.extraFiles` for personal builds.
- Backend Python files use relative imports; run them as modules from repo root, not as direct scripts.

## Proxy Mode

When `PROXY_URL` is set in local `.env`, local backend forwards AI chat, STT, and Spotify search to the remote proxy. TTS, memory, temp cleanup, wake word, and profile/settings remain local.

```
Electron -> local backend (:8765) -> proxy (:7345 / HTTPS reverse proxy) -> Gemini/Groq/OpenAI/Spotify
                         -> local TTS + SQLite + wake word
```

Auth: local backend sends `x-api-key: PROXY_SECRET`; proxy validates against `API_SECRET`. Requests without a valid key get 403 unless hitting `/api/health`.

## State And Persistence

- Local backend loads env from `RAINY_ENV_PATH`, then `RAINY_USER_DATA_DIR/.env`, then repo `.env`.
- `config.py` reads env once at import; changing `.env` requires backend restart.
- Electron userData stores `profile.json`, `avatar-model.json`, `mic-preferences.json`, and `tts-preferences.json`.
- Electron userData stores `profile.json`, `avatar-model.json`, `mic-preferences.json`, `tts-preferences.json`, and `discord-preferences.json`.
- Avatar pose/settings and theme are in renderer `localStorage` under legacy `rainy-*` keys.
- SQLite lives under local data dir as `rainy.sqlite`; temp audio files are served from `/temp` and cleaned by `temp_cleanup.py`.
- Chat history is session-based. `chat_sessions` stores title, summary, summary_message_count, started_at, updated_at; `chat_messages` stores `session_id`, role, content, created_at.
- Current-session selection always uses the latest session. New sessions are manual only via `POST /api/chat/sessions` / chat `Nuevo` button.

## Key Facts

- UI and assistant responses are Spanish by default.
- `rainyDesktop` preload API, `rainy:*` IPC events, and `rainy-*` storage keys are legacy internal names; do not rename them unless doing a dedicated migration.
- Actions execute without confirmation. The AI emits `[ACTION: TYPE "payload"]`; `renderer.js` parses it and calls `main.js:executeAction()`.
- Keep `backend/prompts.py` action allowlist in sync with `executeAction()` and `renderer.js:actionLabel()`.
- AI responses must start with one emotion tag and end with exactly one `[CONVERSATION: ...]` control line; `ai_core.py` strips conversation control before display/TTS.
- Chat context uses memories + current session summary + recent session messages. `main.py` refreshes the session summary in the background every 16 messages.
- Chat UI has a `Nuevo` button that calls `POST /api/chat/sessions` and clears the visible chat. Settings has a Memoria tab that lists/opens/deletes sessions and memories.
- Session titles are generated in the background after 4 messages and refreshed every 16 messages. Opening an old session calls `POST /api/chat/sessions/{id}/activate`, then IPC `chat:open-session` sends `rainy:open-chat-session` to the chat renderer.
- User messages go through `memory_extractor.py` for conservative memories such as `me gusta X`, `prefiero que X`, `recuerda que X`, and names. It intentionally ignores secrets/tokens/password-like content.
- Session summaries also go through `memory_extractor.extract_memories_from_session_summary()` after compaction to promote stable preferences/interests into persistent memories.
- Spotify playback uses Web API search to get `spotify:track:ID`, then opens that URI with `shell.openExternal()`.
- Windows Spotify dance detection polls Spotify window titles via PowerShell every 800ms; avatar enters `dancing` when a non-generic title is detected.
- Integrations toggles live in Settings → Integraciones. Electron stores `wakewordEnabled` and `spotifyActionsEnabled` in `integration-preferences.json`; Spotify actions are blocked in `executeAction()` when disabled.
- Discord Rich Presence uses `discord-rpc` from Electron main. `DISCORD_CLIENT_ID` comes from `.env`; Settings stores only per-user enabled/disabled state and silently reconnects if Discord is not open.
- Media keys use PowerShell + `user32.dll keybd_event` on Windows, AppleScript on macOS, and `playerctl` on Linux.
- PowerShell scripts should use `-EncodedCommand` with Base64 UTF-16LE to avoid escaping issues and flashing shells.
- Custom VRM upload copies `.vrm` files up to 120 MB into `app.getPath('userData')/models`; only user-uploaded models can be deleted.
- OpenWakeWord may download missing model resources into the installed package resources and copy keyword ONNX files from `assets/wakeword`.

## Gotchas

- `.venv/`, `node_modules/`, `dist/`, local SQLite, `temp/`, root `.env`, and `proxy/.env` are gitignored.
- Portable packaging now requires a root `.env` at build time because `build.extraFiles` copies it beside the `.exe`; remove that entry for public builds or use a non-secret `.env`.
- `.env.example` recommends proxy mode, but `config.py` still supports local dev keys for Gemini/Groq/OpenAI/Ollama/Spotify if `PROXY_URL` is empty.
- Do not commit API keys or generated SQLite/temp audio files.
- `requests` is the repo's HTTP client in backend/proxy; avoid adding `httpx` or `aiohttp` without a concrete reason.
- The bundled models and icon use Asuka naming; changing product identity touches package metadata, assets, IPC docs, proxy names, and userData compatibility.
