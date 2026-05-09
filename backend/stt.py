import asyncio

import requests as http_requests
from groq import Groq

from . import config


async def transcribe(file_path):
    if config.PROXY_URL:
        return await _transcribe_proxy(file_path)

    if config.STT_PROVIDER != "groq" or not config.GROQ_API_KEY:
        return None

    def run():
        client = Groq(api_key=config.GROQ_API_KEY)
        with open(file_path, "rb") as file:
            result = client.audio.transcriptions.create(
                file=(file_path.name, file.read()),
                model="whisper-large-v3",
                language=config.STT_LANGUAGE,
                temperature=0,
                response_format="json",
            )
        return result.text

    return await asyncio.to_thread(run)


async def _transcribe_proxy(file_path):
    def run():
        headers = {}
        if config.PROXY_SECRET:
            headers["x-api-key"] = config.PROXY_SECRET
        with open(file_path, "rb") as f:
            resp = http_requests.post(
                f"{config.PROXY_URL}/api/stt",
                files={"file": (file_path.name, f.read())},
                headers=headers,
                timeout=30,
            )
        resp.raise_for_status()
        return resp.json().get("text")

    return await asyncio.to_thread(run)
