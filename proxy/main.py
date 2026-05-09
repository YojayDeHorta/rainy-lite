import asyncio
import base64
import tempfile
import time
from pathlib import Path
from uuid import uuid4

import requests
from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from starlette.responses import JSONResponse

import config


limiter = Limiter(key_func=get_remote_address)
app = FastAPI(title="Asuka Proxy API")
app.state.limiter = limiter


@app.exception_handler(RateLimitExceeded)
async def rate_limit_handler(request: Request, exc: RateLimitExceeded):
    return JSONResponse(
        status_code=429,
        content={"detail": "Rate limit exceeded. Try again later."},
    )


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def verify_api_secret(request: Request, call_next):
    if config.API_SECRET and request.url.path != "/api/health":
        key = request.headers.get("x-api-key", "")
        if key != config.API_SECRET:
            return JSONResponse(status_code=403, content={"detail": "Forbidden"})
    return await call_next(request)


class ChatRequest(BaseModel):
    message: str
    history: list[dict] = []
    bot_name: str | None = None
    user_name: str | None = None
    personality_preset: str | None = None
    personality_custom: str | None = None
    system_prompt: str | None = None


@app.get("/api/health")
def health():
    return {"status": "ok", "provider": config.AI_PROVIDER}


@app.post("/api/chat")
@limiter.limit(config.RATE_LIMIT)
async def chat(req: ChatRequest, request: Request):
    message = req.message.strip()
    if not message:
        raise HTTPException(status_code=400, detail="message is required")

    messages = []
    if req.system_prompt:
        messages.append({"role": "system", "content": req.system_prompt})
    for item in (req.history or [])[-20:]:
        role = "assistant" if item.get("role") == "assistant" else "user"
        messages.append({"role": role, "content": item.get("content", "")})
    messages.append({"role": "user", "content": message})

    provider = config.AI_PROVIDER
    try:
        if provider == "gemini" and config.GEMINI_KEY:
            text = await _generate_gemini(messages, req.system_prompt)
        elif provider == "groq" and config.GROQ_API_KEY:
            text = await _generate_groq(messages)
        elif provider == "openai" and config.OPENAI_API_KEY:
            text = await _generate_openai(messages)
        else:
            raise HTTPException(status_code=503, detail="No AI provider configured on proxy")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"AI provider error: {exc}") from exc

    return {"response": text}


@app.post("/api/stt")
@limiter.limit(config.RATE_LIMIT)
async def speech_to_text(request: Request, file: UploadFile = File(...)):
    if not config.GROQ_API_KEY:
        raise HTTPException(status_code=503, detail="STT not configured on proxy")

    suffix = Path(file.filename or "audio.webm").suffix or ".webm"
    tmp = Path(tempfile.gettempdir()) / f"stt_{uuid4().hex}{suffix}"
    try:
        tmp.write_bytes(await file.read())
        text = await _transcribe_groq(tmp)
        return {"text": text}
    finally:
        tmp.unlink(missing_ok=True)


@app.get("/api/spotify/search")
@limiter.limit(config.RATE_LIMIT)
async def spotify_search(request: Request, q: str = "", limit: int = 5):
    if not q.strip():
        raise HTTPException(status_code=400, detail="q is required")
    try:
        tracks = _spotify_search(q.strip(), limit=limit)
        return {"tracks": tracks}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


# --- AI Providers ---

async def _generate_gemini(messages: list[dict], system_prompt: str | None):
    import google.generativeai as genai

    def run():
        genai.configure(api_key=config.GEMINI_KEY)
        model = genai.GenerativeModel(
            config.AI_MODEL,
            system_instruction=system_prompt or "",
        )
        gemini_history = []
        for item in messages:
            if item["role"] == "system":
                continue
            role = "model" if item["role"] == "assistant" else "user"
            gemini_history.append({"role": role, "parts": [{"text": item["content"]}]})
        user_msg = gemini_history.pop() if gemini_history else {"parts": [{"text": ""}]}
        chat = model.start_chat(history=gemini_history)
        response = chat.send_message(user_msg["parts"][0]["text"])
        return response.text

    return await asyncio.to_thread(run)


async def _generate_groq(messages: list[dict]):
    from groq import Groq

    def run():
        client = Groq(api_key=config.GROQ_API_KEY)
        completion = client.chat.completions.create(
            model=config.GROQ_MODEL,
            messages=messages,
            temperature=config.AI_TEMPERATURE,
            max_completion_tokens=800,
        )
        return completion.choices[0].message.content

    return await asyncio.to_thread(run)


async def _generate_openai(messages: list[dict]):
    from openai import OpenAI

    def run():
        client = OpenAI(base_url=config.OPENAI_BASE_URL, api_key=config.OPENAI_API_KEY)
        completion = client.chat.completions.create(
            model=config.OPENAI_MODEL,
            messages=messages,
            temperature=config.AI_TEMPERATURE,
        )
        return completion.choices[0].message.content

    return await asyncio.to_thread(run)


# --- STT ---

async def _transcribe_groq(file_path: Path):
    from groq import Groq

    def run():
        client = Groq(api_key=config.GROQ_API_KEY)
        with open(file_path, "rb") as f:
            result = client.audio.transcriptions.create(
                file=(file_path.name, f.read()),
                model="whisper-large-v3",
                language=config.STT_LANGUAGE,
                temperature=0,
                response_format="json",
            )
        return result.text

    return await asyncio.to_thread(run)


# --- Spotify ---

_spotify_token_cache = {"access_token": None, "expires_at": 0}


def _get_spotify_token():
    if not config.SPOTIFY_CLIENT_ID or not config.SPOTIFY_CLIENT_SECRET:
        raise RuntimeError("Spotify not configured on proxy")

    now = time.time()
    if _spotify_token_cache["access_token"] and _spotify_token_cache["expires_at"] > now + 30:
        return _spotify_token_cache["access_token"]

    credentials = base64.b64encode(
        f"{config.SPOTIFY_CLIENT_ID}:{config.SPOTIFY_CLIENT_SECRET}".encode()
    ).decode()

    resp = requests.post(
        "https://accounts.spotify.com/api/token",
        headers={
            "Authorization": f"Basic {credentials}",
            "Content-Type": "application/x-www-form-urlencoded",
        },
        data={"grant_type": "client_credentials"},
        timeout=10,
    )
    resp.raise_for_status()
    data = resp.json()
    _spotify_token_cache["access_token"] = data["access_token"]
    _spotify_token_cache["expires_at"] = now + data.get("expires_in", 3600)
    return _spotify_token_cache["access_token"]


def _spotify_search(query: str, limit: int = 5):
    token = _get_spotify_token()
    resp = requests.get(
        "https://api.spotify.com/v1/search",
        headers={"Authorization": f"Bearer {token}"},
        params={"q": query, "type": "track", "limit": limit, "market": "US"},
        timeout=10,
    )
    resp.raise_for_status()
    data = resp.json()

    tracks = []
    for item in data.get("tracks", {}).get("items", []):
        artists = ", ".join(a["name"] for a in item.get("artists", []))
        tracks.append(
            {
                "id": item["id"],
                "uri": item["uri"],
                "name": item["name"],
                "artists": artists,
                "album": item.get("album", {}).get("name", ""),
                "duration_ms": item.get("duration_ms", 0),
                "preview_url": item.get("preview_url"),
            }
        )
    return tracks


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=7345)
