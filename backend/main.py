import asyncio
from pathlib import Path
from uuid import uuid4

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import edge_tts

from . import ai_core, config, memory, memory_extractor, prompts, spotify, stt, temp_cleanup, tts, wakeword


class ChatRequest(BaseModel):
    message: str
    bot_name: str | None = None
    user_name: str | None = None
    personality_preset: str | None = None
    personality_custom: str | None = None


class TTSRequest(BaseModel):
    text: str
    voice: str | None = None
    rate: str | None = None
    pitch: str | None = None
    volume: str | None = None


class MemoryRequest(BaseModel):
    content: str


class SessionRequest(BaseModel):
    title: str | None = None


app = FastAPI(title="Asuka Desktop Local API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/temp", StaticFiles(directory=str(config.TEMP_DIR)), name="temp")

memory.init_db()
SUMMARY_EVERY_MESSAGES = 16
wakeword_service = wakeword.WakewordService(
    enabled=config.WAKEWORD_ENABLED,
    threshold=config.WAKEWORD_THRESHOLD,
    cooldown_s=config.WAKEWORD_COOLDOWN_S,
    keyword_name=config.WAKEWORD_NAME,
    keyword_model=config.WAKEWORD_MODEL_PATH,
    sound_device_spec=config.WAKEWORD_SOUND_DEVICE,
)


@app.on_event("startup")
async def startup():
    memory.init_db()
    wakeword_service.start()
    max_age_s = config.TEMP_FILE_MAX_AGE_MINUTES * 60
    temp_cleanup.sweep_temp_dir(max_age_s)
    interval_s = config.TEMP_CLEANUP_INTERVAL_MINUTES * 60
    asyncio.create_task(temp_cleanup.cleanup_loop(interval_s, max_age_s))


@app.on_event("shutdown")
def shutdown():
    wakeword_service.stop()


@app.get("/api/health")
def health():
    return {"status": "ok", "provider": config.AI_PROVIDER}


@app.get("/api/wakeword/status")
def wakeword_status():
    status = wakeword_service.status()
    return {
        "enabled": status.enabled,
        "ready": status.ready,
        "keyword": status.keyword,
        "backend": status.backend,
        "error": status.error,
        "last_score": status.last_score,
        "peak_score": status.peak_score,
        "capture_device_spec": status.capture_device_spec,
        "capture_device_index": status.capture_device_index,
        "capture_device_name": status.capture_device_name,
    }


@app.get("/api/wakeword/input-devices")
def wakeword_input_devices():
    return wakeword.list_input_audio_devices()


@app.get("/api/wakeword/diagnostics")
def wakeword_diagnostics():
    return wakeword.run_diagnostics()


@app.post("/api/wakeword/consume")
def wakeword_consume():
    status = wakeword_service.status()
    if not status.enabled:
        return {"triggered": False, "ready": False, "enabled": False}
    if not status.ready:
        return {"triggered": False, "ready": False, "enabled": True, "error": status.error}
    return {"triggered": wakeword_service.consume(), "ready": True, "enabled": True}


@app.post("/api/chat")
async def chat(req: ChatRequest):
    message = req.message.strip()
    if not message:
        raise HTTPException(status_code=400, detail="message is required")

    session = memory.get_or_create_current_session()
    session_id = session["id"]
    history = memory.get_chat_history(session_id=session_id)
    memory.add_chat_message("user", message, session_id=session_id)
    for item in memory_extractor.extract_memories_from_user_message(message):
        memory.add_memory(item)
    generated = await ai_core.generate_response_with_metadata(
        message,
        history,
        bot_name=req.bot_name,
        user_name=req.user_name,
        personality_preset=req.personality_preset,
        personality_custom=req.personality_custom,
        session_summary=session.get("summary") or "",
    )
    response = generated.get("response") or ai_core.LOCAL_FALLBACK_REPLY
    conversation = generated.get("conversation") or {"continue": False, "reason": "uncertain"}
    memory.add_chat_message("assistant", response, session_id=session_id)
    asyncio.create_task(update_session_summary_if_needed(session_id))
    return {"response": response, "conversation": conversation, "session_id": session_id}


async def update_session_summary_if_needed(session_id: int):
    session = memory.get_session(session_id)
    if not session:
        return
    message_count = memory.count_session_messages(session_id)
    summarized_at = int(session.get("summary_message_count") or 0)
    if message_count < SUMMARY_EVERY_MESSAGES:
        return
    if message_count - summarized_at < SUMMARY_EVERY_MESSAGES:
        return
    messages = memory.get_session_messages_for_summary(session_id, limit=80)
    summary = await ai_core.summarize_conversation(session.get("summary") or "", messages)
    if summary:
        memory.update_session_summary(session_id, summary, message_count)


@app.get("/api/personality/presets")
def personality_presets():
    return {"presets": prompts.list_personality_presets_public()}


@app.get("/api/chat/history")
def chat_history():
    session = memory.get_or_create_current_session()
    return {"session": session, "messages": memory.get_chat_history(limit=50, session_id=session["id"])}


@app.get("/api/chat/sessions")
def chat_sessions():
    return {"sessions": memory.list_sessions(limit=30)}


@app.get("/api/chat/sessions/{session_id}/messages")
def chat_session_messages(session_id: int):
    session = memory.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="session not found")
    return {"session": session, "messages": memory.get_chat_history(limit=100, session_id=session_id)}


@app.post("/api/chat/sessions")
def create_chat_session(req: SessionRequest):
    return {"session": memory.create_new_session(title=req.title)}


@app.delete("/api/chat/sessions/{session_id}")
def delete_chat_session(session_id: int):
    memory.delete_session(session_id)
    return {"status": "ok"}


@app.delete("/api/chat/history")
def clear_chat_history():
    memory.clear_chat()
    return {"status": "ok"}


@app.post("/api/memory")
def remember(req: MemoryRequest):
    memory.add_memory(req.content)
    return {"status": "ok"}


@app.get("/api/memory")
def memories():
    return {"items": memory.get_memories()}


@app.delete("/api/memory/{memory_id}")
def delete_memory(memory_id: int):
    memory.delete_memory(memory_id)
    return {"status": "ok"}


@app.delete("/api/memory")
def clear_memories():
    memory.clear_memories()
    return {"status": "ok"}


@app.get("/api/spotify/search")
async def spotify_search(q: str = "", limit: int = 5):
    if not q.strip():
        raise HTTPException(status_code=400, detail="q is required")
    try:
        tracks = spotify.search_track(q.strip(), limit=limit)
        return {"tracks": tracks}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.get("/api/tts/defaults")
def tts_defaults():
    return {
        "voice": config.TTS_VOICE,
        "rate": config.TTS_RATE,
        "pitch": config.TTS_PITCH,
        "volume": config.TTS_VOLUME,
    }


@app.get("/api/tts/voices")
async def tts_voices():
    try:
        raw = await edge_tts.list_voices()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    items = []
    for vo in raw:
        friendly = vo.get("FriendlyName") or vo.get("LocalName") or vo.get("ShortName") or ""
        items.append(
            {
                "short_name": vo.get("ShortName") or "",
                "friendly_name": friendly,
                "locale": vo.get("Locale") or "",
                "gender": vo.get("Gender") or "",
            }
        )
    items.sort(key=lambda x: (x["locale"].lower(), x["short_name"].lower()))
    return {"voices": items}


@app.post("/api/tts")
async def synthesize(req: TTSRequest):
    try:
        audio_path = await tts.synthesize(
            req.text,
            voice=req.voice,
            rate=req.rate,
            pitch=req.pitch,
            volume=req.volume,
        )
        temp_cleanup.sweep_temp_dir(config.TEMP_FILE_MAX_AGE_MINUTES * 60)
        return {"url": f"/temp/{audio_path.name}"}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/stt")
async def speech_to_text(file: UploadFile = File(...)):
    suffix = Path(file.filename or "audio.webm").suffix or ".webm"
    temp_path = config.TEMP_DIR / f"stt_{uuid4().hex}{suffix}"
    try:
        temp_path.write_bytes(await file.read())
        text = await stt.transcribe(temp_path)
        if not text:
            raise HTTPException(status_code=503, detail="STT provider is not configured")
        return {"text": text}
    finally:
        temp_path.unlink(missing_ok=True)
