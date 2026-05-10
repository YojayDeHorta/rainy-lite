import re


MAX_MEMORY_CHARS = 180


def _clean_value(value: str) -> str:
    cleaned = re.sub(r"\s+", " ", value or "").strip(" .,!¡¿?;:\"'")
    return cleaned[:MAX_MEMORY_CHARS].strip()


def _sentence_case(text: str) -> str:
    if not text:
        return text
    return text[0].upper() + text[1:]


def extract_memories_from_user_message(message: str) -> list[str]:
    text = re.sub(r"\s+", " ", message or "").strip()
    if not text:
        return []

    lowered = text.lower()
    if any(blocked in lowered for blocked in ["contraseña", "contrasena", "password", "token", "api key", "apikey", "secret"]):
        return []

    memories: list[str] = []
    patterns = [
        (r"\brecuerda que (.+)$", lambda v: _sentence_case(v)),
        (r"\bacu[eé]rdate de que (.+)$", lambda v: _sentence_case(v)),
        (r"\bme gusta[n]? (.+)$", lambda v: f"Al usuario le gusta {v}"),
        (r"\bme encanta[n]? (.+)$", lambda v: f"Al usuario le encanta {v}"),
        (r"\bprefiero que (.+)$", lambda v: f"El usuario prefiere que {v}"),
        (r"\bno me gusta[n]? (.+)$", lambda v: f"Al usuario no le gusta {v}"),
        (r"\bmi nombre es (.+)$", lambda v: f"El usuario se llama {v}"),
        (r"\bme llamo (.+)$", lambda v: f"El usuario se llama {v}"),
    ]

    for pattern, build in patterns:
        match = re.search(pattern, text, flags=re.I)
        if not match:
            continue
        value = _clean_value(match.group(1))
        if not value or len(value) < 2:
            continue
        memories.append(_clean_value(build(value)))

    unique = []
    seen = set()
    for item in memories:
        key = item.lower()
        if key in seen:
            continue
        seen.add(key)
        unique.append(item)
    return unique[:3]
