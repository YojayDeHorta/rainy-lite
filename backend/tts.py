from uuid import uuid4

import edge_tts

from . import config


async def synthesize(text: str):
    safe_text = text.strip()
    if not safe_text:
        safe_text = "Estoy aqui."

    output_path = config.TEMP_DIR / f"tts_{uuid4().hex}.mp3"
    communicate = edge_tts.Communicate(
        safe_text,
        config.TTS_VOICE,
        rate=config.TTS_RATE,
        pitch=config.TTS_PITCH,
    )
    await communicate.save(str(output_path))
    return output_path
