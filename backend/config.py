import os
from pathlib import Path

from dotenv import load_dotenv


ROOT_DIR = Path(__file__).resolve().parents[1]
USER_DATA_DIR = Path(os.getenv("RAINY_USER_DATA_DIR", "")).expanduser() if os.getenv("RAINY_USER_DATA_DIR") else None

env_candidates = []
explicit_env = os.getenv("RAINY_ENV_PATH", "").strip()
if explicit_env:
    env_candidates.append(Path(explicit_env))
if USER_DATA_DIR:
    env_candidates.append(USER_DATA_DIR / ".env")
env_candidates.append(ROOT_DIR / ".env")

for env_path in env_candidates:
    if env_path and env_path.exists():
        load_dotenv(env_path, override=False)

DATA_DIR = (USER_DATA_DIR / "data") if USER_DATA_DIR else (ROOT_DIR / "data")
TEMP_DIR = (USER_DATA_DIR / "temp") if USER_DATA_DIR else (ROOT_DIR / "temp")
DATA_DIR.mkdir(exist_ok=True)
TEMP_DIR.mkdir(exist_ok=True)

TEMP_FILE_MAX_AGE_MINUTES = max(5, int(os.getenv("TEMP_FILE_MAX_AGE_MINUTES", "45")))
TEMP_CLEANUP_INTERVAL_MINUTES = max(1, int(os.getenv("TEMP_CLEANUP_INTERVAL_MINUTES", "10")))

APP_HOST = os.getenv("RAINY_HOST", "127.0.0.1")
APP_PORT = int(os.getenv("RAINY_PORT", "8765"))

AI_PROVIDER = os.getenv("AI_PROVIDER", "local").strip().lower()
AI_MODEL = os.getenv("AI_MODEL", "gemini-1.5-flash")
AI_TEMPERATURE = float(os.getenv("AI_TEMPERATURE", "0.8"))

GEMINI_KEY = os.getenv("GEMINI_KEY", "")
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GROQ_MODEL = os.getenv("GROQ_MODEL", "llama-3.1-8b-instant")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://127.0.0.1:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.1")

SPOTIFY_CLIENT_ID = os.getenv("SPOTIFY_CLIENT_ID", "")
SPOTIFY_CLIENT_SECRET = os.getenv("SPOTIFY_CLIENT_SECRET", "")

STT_PROVIDER = os.getenv("STT_PROVIDER", "groq").strip().lower()
STT_LANGUAGE = os.getenv("STT_LANGUAGE", "es")
TTS_VOICE = os.getenv("TTS_VOICE", "es-MX-DaliaNeural")
TTS_RATE = os.getenv("TTS_RATE", "+8%")
TTS_PITCH = os.getenv("TTS_PITCH", "+20Hz")
TTS_VOLUME = os.getenv("TTS_VOLUME", "+0%")

WAKEWORD_ENABLED = os.getenv("WAKEWORD_ENABLED", "0").strip().lower() in {"1", "true", "yes", "on"}
WAKEWORD_THRESHOLD = float(os.getenv("WAKEWORD_THRESHOLD", "0.55"))
WAKEWORD_COOLDOWN_S = float(os.getenv("WAKEWORD_COOLDOWN_S", "2.5"))
WAKEWORD_NAME = os.getenv("WAKEWORD_NAME", "alexa").strip().lower()
WAKEWORD_MODEL_PATH = os.getenv("WAKEWORD_MODEL_PATH", "").strip()
WAKEWORD_SOUND_DEVICE = os.getenv("WAKEWORD_SOUND_DEVICE", "").strip()

SQLITE_PATH = DATA_DIR / "rainy.sqlite"
