from uuid import uuid4

import edge_tts

from . import config


async def synthesize(
    text: str,
    *,
    voice: str | None = None,
    rate: str | None = None,
    pitch: str | None = None,
    volume: str | None = None,
):
    safe_text = text.strip()
    if not safe_text:
        safe_text = "Estoy aqui."

    v = (voice or "").strip() or config.TTS_VOICE
    r = (rate or "").strip() or config.TTS_RATE
    p = (pitch or "").strip() or config.TTS_PITCH
    vol = (volume or "").strip() or config.TTS_VOLUME

    output_path = config.TEMP_DIR / f"tts_{uuid4().hex}.mp3"
    communicate = edge_tts.Communicate(safe_text, v, rate=r, pitch=p, volume=vol)
    await communicate.save(str(output_path))
    return output_path
