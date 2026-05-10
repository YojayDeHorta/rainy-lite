# Asuka Desktop

Asuka Desktop is a Windows-first desktop AI companion. It uses Electron for the desktop UI and a local FastAPI backend for orchestration, TTS, wake word, memory, STT forwarding, Spotify forwarding, and local dev fallbacks.

## Current MVP

- Separate floating avatar window and chat/control window.
- First-run setup for assistant name, user name, personality, and VRM model.
- Settings window for theme, microphone, personality, avatar pose/model, and Edge TTS voice.
- Integrations panel for Wake Word, Spotify actions, and Discord Rich Presence toggles.
- Tray icon for quickly showing chat/avatar, opening settings, or exiting.
- Optional launch on Windows startup from Settings.
- Memory/settings panel for recent sessions and persistent memories.
- VRM avatar loader with bundled models in `assets/models/` and support for user-uploaded `.vrm` files.
- Cursor tracking, blinking, micro-expressions, click reactions, lip sync, and Spotify dancing states.
- Text chat with local backend plus optional remote proxy for AI keys.
- TTS with `edge-tts` running locally.
- Voice input with STT through proxy or local Groq Whisper.
- Optional wake word using OpenWakeWord.
- SQLite chat sessions, recent-history loading, automatic session summaries, and persistent memory storage.
- Windows portable build with `electron-builder`.

## Setup

```bash
cd rainy-lite
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
npm install
cp .env.example .env
```

On Windows:

```powershell
cd rainy-lite
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
npm install
copy .env.example .env
```

Recommended app config is proxy mode:

```ini
PROXY_URL=https://your-proxy.example.com
PROXY_SECRET=shared_secret_matching_proxy_API_SECRET
```

The local backend still supports direct local API keys when `PROXY_URL` is empty; see `.env.example`.

## Run

```bash
npm run dev
```

Electron starts the local backend automatically on `127.0.0.1:8765`. On first run, Asuka opens the setup window. After setup, it opens the avatar and keeps the chat window available through the avatar button or global shortcut.

Global shortcuts:

- `Ctrl+Shift+R`: start/stop voice recording.
- `Ctrl+Shift+H`: hide/show chat.
- `Ctrl+Shift+A`: hide/show avatar.

## Proxy Backend

The `proxy/` folder is a deployable FastAPI service that stores provider keys server-side and exposes:

- `POST /api/chat`
- `POST /api/stt`
- `GET /api/spotify/search`

Setup:

```bash
cd proxy
cp .env.example .env
docker compose up -d
```

Set `API_SECRET` in `proxy/.env` and the same value in the app's `PROXY_SECRET`. The proxy listens on port `7345`; put it behind HTTPS with nginx/Caddy for distribution.

## Safe System Actions

Asuka can execute a limited set of desktop actions directly. Actions are restricted to an allowlist in the prompt and Electron main process.

Supported actions:

- `OPEN_URL`: open an `http` or `https` URL.
- `OPEN_APP`: open an allowlisted app such as `notepad`, `calculator`, `chrome`, `edge`, `explorer`, `vscode`, or `spotify`.
- `OPEN_FOLDER`: open a folder path.
- `COPY_TEXT`: copy text to the clipboard.
- `MEDIA_PLAY_PAUSE`: toggle media playback.
- `MEDIA_NEXT`: skip to the next track.
- `MEDIA_PREVIOUS`: go to the previous track.
- `SPOTIFY_SEARCH`: open a Spotify search.
- `SPOTIFY_SEARCH_AND_PLAY`: search Spotify Web API, resolve the first track, and open its `spotify:track:ID` URI.
- `SHOW_AVATAR` / `HIDE_AVATAR`: show or hide the avatar window.

Spotify track search uses Client Credentials flow either on the proxy or locally. It does not need user OAuth.

## Avatar Models

Bundled models live in:

```txt
assets/models/*.vrm
```

User-uploaded models are copied to Electron's user data folder under `models/`. Custom uploads are capped at 120 MB and can be deleted from settings; bundled models are read-only.

The settings window can correct model yaw, pitch, arm hang, arm abduction, scale, camera distance, light, and motion intensity. These values are stored locally.

## History And Memory

Asuka stores chat locally in SQLite. On startup, the chat window reloads the current session's recent messages so the conversation is visible again.

Sessions are manual: Asuka keeps using the latest session until you press “Nuevo” in the chat.

Every 16 messages, the backend refreshes a compact summary of the current session. Future replies use:

- persistent memories
- current session summary
- recent messages from the current session

Persistent memories are stored separately from chat history and are available through `/api/memory`. Asuka conservatively extracts simple stable facts from user messages such as “me gusta X”, “prefiero que X”, “recuerda que X”, or “me llamo X”, while ignoring password/token/secret-like content.

After a session summary is generated, the backend also extracts stable preferences from that summary into persistent memories, for example music tastes or recurring interests. These memories remain visible and deletable in Settings → Memoria.

Use the chat titlebar button “Nuevo” to start a fresh conversation manually. The settings window includes a “Memoria” tab to review/delete recent sessions and persistent memories.

After a few messages, Asuka renames the session automatically with a short topic-based title. In Settings → Memoria, use “Abrir” to recover an older session in the chat.

## Wake Word

Wake word is disabled by default. Enable it in `.env`:

```ini
WAKEWORD_ENABLED=1
WAKEWORD_NAME=alexa
WAKEWORD_THRESHOLD=0.55
WAKEWORD_COOLDOWN_S=2.5
```

Bundled wake-word models live in `assets/wakeword/`. You can use a custom ONNX with:

```ini
WAKEWORD_MODEL_PATH=C:\path\to\custom_model.onnx
```

If Bluetooth headphones switch to a bad hands-free microphone profile, pin a specific input device with `WAKEWORD_SOUND_DEVICE`. Device IDs are available at:

```txt
GET http://127.0.0.1:8765/api/wakeword/input-devices
```

## Discord Rich Presence

Discord integration is optional. Put your Discord Developer Portal Application ID in `.env` as `DISCORD_CLIENT_ID`, then each user can enable or disable Rich Presence from Settings → Integraciones. If the local Discord client is open, Asuka shows a Rich Presence state such as listening, thinking, speaking, or dancing with Spotify.

No Discord token is required; the Application ID is public and safe to ship in `.env`.

## Build

Windows portable build:

```bash
npm run dist:portable
```

The build includes `app/`, `backend/`, `assets/`, `.venv/`, `requirements.txt`, and copies the root `.env` next to the portable `.exe`. Backend files and `.venv` are unpacked from ASAR so Python can run them.

For shared/public builds, remove the `extraFiles` `.env` entry from `package.json` or use a `.env` without secrets.
