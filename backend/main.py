from pathlib import Path
from uuid import uuid4

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import ai_core, config, memory, spotify, stt, tts, wakeword


class ChatRequest(BaseModel):
    message: str


class TTSRequest(BaseModel):
    text: str


class MemoryRequest(BaseModel):
    content: str


app = FastAPI(title="Rainy Lite Local API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/temp", StaticFiles(directory=str(config.TEMP_DIR)), name="temp")

memory.init_db()
wakeword_service = wakeword.WakewordService(
    enabled=config.WAKEWORD_ENABLED,
    threshold=config.WAKEWORD_THRESHOLD,
    cooldown_s=config.WAKEWORD_COOLDOWN_S,
    keyword_name=config.WAKEWORD_NAME,
    keyword_model=config.WAKEWORD_MODEL_PATH,
)


@app.on_event("startup")
def startup():
    memory.init_db()
    wakeword_service.start()


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
    }


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

    history = memory.get_chat_history()
    memory.add_chat_message("user", message)
    response = await ai_core.generate_response(message, history)
    memory.add_chat_message("assistant", response)
    return {"response": response}


@app.get("/api/chat/history")
def chat_history():
    return memory.get_chat_history(limit=50)


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


@app.get("/api/spotify/search")
async def spotify_search(q: str = "", limit: int = 5):
    if not q.strip():
        raise HTTPException(status_code=400, detail="q is required")
    try:
        tracks = spotify.search_track(q.strip(), limit=limit)
        return {"tracks": tracks}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.post("/api/tts")
async def synthesize(req: TTSRequest):
    try:
        audio_path = await tts.synthesize(req.text)
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
