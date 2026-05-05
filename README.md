# Rainy Lite

Rainy Lite is a Windows-first desktop AI companion prototype. It uses Electron for the transparent desktop window and a local FastAPI backend for chat, TTS, STT and memory.

## Current MVP

- Transparent frameless desktop window.
- Always-on-top toggle.
- Global shortcuts:
  - `Ctrl+Shift+R`: start/stop voice recording.
  - `Ctrl+Shift+H`: hide/show Rainy.
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
