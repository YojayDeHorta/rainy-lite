import asyncio
import time

from . import config


def sweep_temp_dir(max_age_seconds: float) -> int:
    removed = 0
    now = time.time()
    directory = config.TEMP_DIR
    if not directory.is_dir():
        return 0
    for path in directory.iterdir():
        if not path.is_file():
            continue
        name = path.name
        if name == ".gitkeep":
            continue
        if not (name.startswith("tts_") or name.startswith("stt_")):
            continue
        try:
            if now - path.stat().st_mtime >= max_age_seconds:
                path.unlink(missing_ok=True)
                removed += 1
        except OSError:
            continue
    return removed


async def cleanup_loop(interval_seconds: float, max_age_seconds: float) -> None:
    while True:
        await asyncio.sleep(interval_seconds)
        sweep_temp_dir(max_age_seconds)
