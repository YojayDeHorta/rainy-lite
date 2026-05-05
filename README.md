# Rainy Lite

Rainy Lite is a Windows-first desktop AI companion prototype. It uses Electron for the transparent desktop window and a local FastAPI backend for chat, TTS, STT and memory.

## Current MVP

- Transparent frameless desktop window.
- Separate floating avatar window and chat/control window.
- Always-on-top toggle per window.
- Global shortcuts:
  - `Ctrl+Shift+R`: start/stop voice recording.
  - `Ctrl+Shift+H`: hide/show chat.
  - `Ctrl+Shift+A`: hide/show avatar.
- Text chat with local FastAPI backend.
- TTS with `edge-tts`.
- Optional STT with Groq Whisper.
- SQLite memory/chat storage.
- VRM avatar loader with CSS fallback when no model exists.

## Setup

```bash
cd rainy-lite
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
npm install
cp .env.example .env
```

On Windows, use:

```powershell
cd rainy-lite
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
npm install
copy .env.example .env
```

## Run

```bash
npm run dev
```

Electron starts the local backend automatically on `127.0.0.1:8765`.

Rainy opens two windows:

- Avatar window: the floating assistant meant to stay over the desktop.
- Chat window: text chat, microphone button and controls.

The avatar window is intentionally clean: it only shows the character. Text responses stay in the chat window.

Use the gear button in the chat window to tune the avatar in real time:

- Horizontal position.
- Vertical position.
- Model scale.
- Camera distance.
- Light intensity.
- Idle movement intensity.

Those values are saved locally and restored on the next launch.

The avatar also has lightweight live behavior inspired by Asuka Lite:

- Cursor tracking with head/neck motion.
- Random micro-expressions while idle.
- Click reactions on the avatar window.
- Different motion states for idle, listening, thinking and speaking.

## Safe System Actions

Rainy can execute a limited set of desktop actions directly. Actions are still restricted to an allowlist.

Supported actions:

- `OPEN_URL`: open an `http` or `https` URL.
- `OPEN_APP`: open an allowlisted app such as `notepad`, `calculator`, `chrome`, `edge`, `explorer` or `vscode` on Windows.
- `OPEN_FOLDER`: open a folder path.
- `COPY_TEXT`: copy text to the clipboard.
- `MEDIA_PLAY_PAUSE`: toggle media playback.
- `MEDIA_NEXT`: skip to the next track.
- `MEDIA_PREVIOUS`: go to the previous track.
- `SHOW_AVATAR` / `HIDE_AVATAR`: show or hide the avatar window.

Spotify can be opened with `OPEN_APP "spotify"`. Media controls use the OS media layer, so they can control Spotify or another active media player depending on the system.

## Avatar

Rainy looks for a VRM model at:

```txt
assets/rainy.vrm
```

If that file does not exist, the app keeps using the animated CSS placeholder. Once a VRM is present, the renderer enables:

- Transparent Three.js render layer.
- Idle breathing/head motion.
- Natural blinking.
- Basic emotion tags from the LLM.
- Basic mouth movement from TTS audio.

## AI Providers

Default mode is `AI_PROVIDER=local`, which only returns a fallback reply. Set one provider in `.env`:

```ini
AI_PROVIDER=gemini
GEMINI_KEY=your_key
```

or:

```ini
AI_PROVIDER=groq
GROQ_API_KEY=your_key
```

STT currently uses Groq Whisper, so voice transcription needs `GROQ_API_KEY`.

## Next Steps

- Expand the VRM renderer with pointer reactions and higher quality animations from `asuka-lite`.
- Add a real `assets/rainy.vrm` model.
- Add wake word support instead of only global hotkey.
- Add safe Windows actions through explicit backend commands.
- Add tray icon and packaged Windows builds.
