import asyncio

from groq import Groq

from . import config


async def transcribe(file_path):
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
