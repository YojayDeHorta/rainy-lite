import os
from pathlib import Path

from dotenv import load_dotenv

ROOT_DIR = Path(__file__).resolve().parent
load_dotenv(ROOT_DIR / ".env", override=False)

AI_PROVIDER = os.getenv("AI_PROVIDER", "gemini").strip().lower()
AI_MODEL = os.getenv("AI_MODEL", "gemini-2.0-flash")
AI_TEMPERATURE = float(os.getenv("AI_TEMPERATURE", "0.8"))

GEMINI_KEY = os.getenv("GEMINI_KEY", "")
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GROQ_MODEL = os.getenv("GROQ_MODEL", "llama-3.1-8b-instant")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")

SPOTIFY_CLIENT_ID = os.getenv("SPOTIFY_CLIENT_ID", "")
SPOTIFY_CLIENT_SECRET = os.getenv("SPOTIFY_CLIENT_SECRET", "")

STT_LANGUAGE = os.getenv("STT_LANGUAGE", "es")

RATE_LIMIT = os.getenv("RATE_LIMIT", "30/minute")
API_SECRET = os.getenv("API_SECRET", "")
