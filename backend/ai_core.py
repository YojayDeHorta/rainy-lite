import asyncio
import re

import requests

from . import config
from .memory import get_memories
from .prompts import LOCAL_FALLBACK_REPLY, build_system_prompt

CONVERSATION_CONTROL_RE = re.compile(
    r"\[CONVERSATION:\s*(CONTINUE|STOP)(?:\s+\"(followup|goodbye|one_shot|uncertain)\")?\s*\]",
    re.I,
)
ACTION_TAG_RE = re.compile(r"\[ACTION:\s*\w+(?:\s+\"[\s\S]*?\")?\s*\]", re.I)
GOODBYE_RE = re.compile(r"\b(adios|adiós|chao|hasta luego|nos vemos|bye|gracias(,)? eso es todo)\b", re.I)
SUMMARY_SYSTEM_PROMPT = """
Resume la conversacion para usarla como contexto futuro de un asistente de escritorio.
Conserva solo informacion util: temas tratados, decisiones, preferencias estables del usuario,
tareas pendientes y datos de contexto que ayuden en proximas respuestas.
No inventes, no guardes secretos, tokens, contrasenas ni datos extremadamente sensibles.
Maximo 1200 caracteres. Responde solo con el resumen en espanol.
""".strip()


def parse_conversation_control(text: str) -> dict:
    match = CONVERSATION_CONTROL_RE.search(text or "")
    if not match:
        return {"continue": False, "reason": "uncertain"}
    should_continue = match.group(1).upper() == "CONTINUE"
    reason = (match.group(2) or ("followup" if should_continue else "uncertain")).lower()
    if reason not in {"followup", "goodbye", "one_shot", "uncertain"}:
        reason = "uncertain"
    return {"continue": should_continue, "reason": reason}


def infer_conversation_control(message: str, raw_response: str) -> dict:
    user_text = (message or "").strip()
    response_text = (raw_response or "").strip()
    clean_text = clean_response(response_text)
    if GOODBYE_RE.search(user_text):
        return {"continue": False, "reason": "goodbye"}
    if ACTION_TAG_RE.search(response_text):
        return {"continue": False, "reason": "one_shot"}
    if user_text.endswith("?") or "?" in user_text:
        return {"continue": True, "reason": "followup"}
    if clean_text.endswith("?"):
        return {"continue": True, "reason": "followup"}
    return {"continue": False, "reason": "uncertain"}


def clean_response(text: str) -> str:
    text = re.sub(r"<think>.*?</think>", "", text or "", flags=re.DOTALL).strip()
    text = CONVERSATION_CONTROL_RE.sub("", text).strip()
    if not re.match(r"^\[(NEUTRAL|HAPPY|SAD|SURPRISED|THINKING|SHY)\]", text, re.I):
        text = f"[NEUTRAL] {text}" if text else LOCAL_FALLBACK_REPLY
    return text


def _messages_for_chat(
    message: str,
    history: list[dict],
    bot_name: str | None = None,
    user_name: str | None = None,
    personality_preset: str | None = None,
    personality_custom: str | None = None,
    session_summary: str | None = None,
):
    memories = get_memories()
    system_text = build_contextual_system_prompt(
        bot_name,
        user_name,
        personality_preset=personality_preset,
        personality_custom=personality_custom,
        memories=memories,
        session_summary=session_summary,
    )
    messages = [{"role": "system", "content": system_text}]
    for item in history[-20:]:
        role = "assistant" if item["role"] == "assistant" else "user"
        messages.append({"role": role, "content": item["content"]})
    messages.append({"role": "user", "content": message})
    return messages


def build_contextual_system_prompt(
    bot_name: str | None = None,
    user_name: str | None = None,
    personality_preset: str | None = None,
    personality_custom: str | None = None,
    memories: list[str] | None = None,
    session_summary: str | None = None,
) -> str:
    system_text = build_system_prompt(
        bot_name,
        user_name,
        personality_preset=personality_preset,
        personality_custom=personality_custom,
    )
    blocks = [system_text]
    if memories:
        blocks.append("Memorias del usuario:\n" + "\n".join(f"- {item}" for item in memories))
    if session_summary and session_summary.strip():
        blocks.append("Resumen de la sesion actual:\n" + session_summary.strip())
    return "\n\n".join(blocks)


async def generate_response(
    message: str,
    history: list[dict],
    bot_name: str | None = None,
    user_name: str | None = None,
    personality_preset: str | None = None,
    personality_custom: str | None = None,
    session_summary: str | None = None,
):
    provider = config.AI_PROVIDER
    if provider == "gemini" and config.GEMINI_KEY:
        return clean_response(
            await _generate_gemini(
                message,
                history,
                bot_name,
                user_name,
                personality_preset=personality_preset,
                personality_custom=personality_custom,
                session_summary=session_summary,
            )
        )
    if provider == "groq" and config.GROQ_API_KEY:
        return clean_response(
            await _generate_groq(
                message,
                history,
                bot_name,
                user_name,
                personality_preset=personality_preset,
                personality_custom=personality_custom,
                session_summary=session_summary,
            )
        )
    if provider == "openai" and config.OPENAI_API_KEY:
        return clean_response(
            await _generate_openai(
                message,
                history,
                bot_name,
                user_name,
                personality_preset=personality_preset,
                personality_custom=personality_custom,
                session_summary=session_summary,
            )
        )
    if provider == "ollama":
        return clean_response(
            await _generate_ollama(
                message,
                history,
                bot_name,
                user_name,
                personality_preset=personality_preset,
                personality_custom=personality_custom,
                session_summary=session_summary,
            )
        )
    return LOCAL_FALLBACK_REPLY


async def _proxy_chat(message: str, history: list[dict], system_prompt: str) -> str:
    def run():
        headers = {}
        if config.PROXY_SECRET:
            headers["x-api-key"] = config.PROXY_SECRET
        resp = requests.post(
            f"{config.PROXY_URL}/api/chat",
            json={
                "message": message,
                "history": history[-20:],
                "system_prompt": system_prompt,
            },
            headers=headers,
            timeout=60,
        )
        resp.raise_for_status()
        return resp.json().get("response", "")

    return await asyncio.to_thread(run)


async def summarize_conversation(existing_summary: str, messages: list[dict]) -> str:
    if not messages:
        return existing_summary.strip()

    transcript = "\n".join(
        f"{('Usuario' if item.get('role') == 'user' else 'Asistente')}: {item.get('content', '').strip()}"
        for item in messages
        if item.get("content")
    )
    prompt = (
        f"Resumen anterior:\n{existing_summary.strip() or '(sin resumen previo)'}\n\n"
        f"Mensajes recientes:\n{transcript}"
    )

    if config.PROXY_URL:
        try:
            return (await _proxy_chat(prompt, [], SUMMARY_SYSTEM_PROMPT)).strip()[:1600]
        except Exception:
            return existing_summary.strip()

    if config.AI_PROVIDER == "local":
        return existing_summary.strip()

    try:
        if config.AI_PROVIDER == "groq" and config.GROQ_API_KEY:
            from groq import Groq

            def run_groq():
                client = Groq(api_key=config.GROQ_API_KEY)
                completion = client.chat.completions.create(
                    model=config.GROQ_MODEL,
                    messages=[
                        {"role": "system", "content": SUMMARY_SYSTEM_PROMPT},
                        {"role": "user", "content": prompt},
                    ],
                    temperature=0.2,
                    max_completion_tokens=500,
                )
                return completion.choices[0].message.content or ""

            return (await asyncio.to_thread(run_groq)).strip()[:1600]
        if config.AI_PROVIDER == "openai" and config.OPENAI_API_KEY:
            from openai import OpenAI

            def run_openai():
                client = OpenAI(base_url=config.OPENAI_BASE_URL, api_key=config.OPENAI_API_KEY)
                completion = client.chat.completions.create(
                    model=config.OPENAI_MODEL,
                    messages=[
                        {"role": "system", "content": SUMMARY_SYSTEM_PROMPT},
                        {"role": "user", "content": prompt},
                    ],
                    temperature=0.2,
                )
                return completion.choices[0].message.content or ""

            return (await asyncio.to_thread(run_openai)).strip()[:1600]
    except Exception:
        return existing_summary.strip()

    return existing_summary.strip()


async def generate_response_with_metadata(
    message: str,
    history: list[dict],
    bot_name: str | None = None,
    user_name: str | None = None,
    personality_preset: str | None = None,
    personality_custom: str | None = None,
    session_summary: str | None = None,
):
    if config.PROXY_URL:
        system_prompt = build_contextual_system_prompt(
            bot_name,
            user_name,
            personality_preset=personality_preset,
            personality_custom=personality_custom,
            memories=get_memories(),
            session_summary=session_summary,
        )
        try:
            raw_response = await _proxy_chat(message, history, system_prompt)
        except Exception:
            raw_response = ""
        if not raw_response:
            return {
                "response": LOCAL_FALLBACK_REPLY,
                "conversation": {"continue": False, "reason": "uncertain"},
            }
        parsed = parse_conversation_control(raw_response)
        if parsed["reason"] == "uncertain":
            parsed = infer_conversation_control(message, raw_response)
        return {
            "response": clean_response(raw_response),
            "conversation": parsed,
        }

    provider = config.AI_PROVIDER
    raw_response = ""
    if provider == "gemini" and config.GEMINI_KEY:
            raw_response = await _generate_gemini(
            message,
            history,
            bot_name,
            user_name,
            personality_preset=personality_preset,
            personality_custom=personality_custom,
            session_summary=session_summary,
        )
    elif provider == "groq" and config.GROQ_API_KEY:
        raw_response = await _generate_groq(
            message,
            history,
            bot_name,
            user_name,
            personality_preset=personality_preset,
            personality_custom=personality_custom,
            session_summary=session_summary,
        )
    elif provider == "openai" and config.OPENAI_API_KEY:
        raw_response = await _generate_openai(
            message,
            history,
            bot_name,
            user_name,
            personality_preset=personality_preset,
            personality_custom=personality_custom,
            session_summary=session_summary,
        )
    elif provider == "ollama":
        raw_response = await _generate_ollama(
            message,
            history,
            bot_name,
            user_name,
            personality_preset=personality_preset,
            personality_custom=personality_custom,
            session_summary=session_summary,
        )

    if not raw_response:
        return {
            "response": LOCAL_FALLBACK_REPLY,
            "conversation": {"continue": False, "reason": "uncertain"},
        }

    parsed = parse_conversation_control(raw_response)
    if parsed["reason"] == "uncertain":
        parsed = infer_conversation_control(message, raw_response)
    return {
        "response": clean_response(raw_response),
        "conversation": parsed,
    }


async def _generate_gemini(
    message: str,
    history: list[dict],
    bot_name: str | None = None,
    user_name: str | None = None,
    personality_preset: str | None = None,
    personality_custom: str | None = None,
    session_summary: str | None = None,
):
    import google.generativeai as genai

    def run():
        genai.configure(api_key=config.GEMINI_KEY)
        model = genai.GenerativeModel(
            config.AI_MODEL,
            system_instruction=build_contextual_system_prompt(
                bot_name,
                user_name,
                personality_preset=personality_preset,
                personality_custom=personality_custom,
                memories=get_memories(),
                session_summary=session_summary,
            ),
        )
        gemini_history = []
        for item in history[-20:]:
            role = "model" if item["role"] == "assistant" else "user"
            gemini_history.append({"role": role, "parts": [{"text": item["content"]}]})
        chat = model.start_chat(history=gemini_history)
        response = chat.send_message(message)
        return response.text

    return await asyncio.to_thread(run)


async def _generate_groq(
    message: str,
    history: list[dict],
    bot_name: str | None = None,
    user_name: str | None = None,
    personality_preset: str | None = None,
    personality_custom: str | None = None,
    session_summary: str | None = None,
):
    from groq import Groq

    def run():
        client = Groq(api_key=config.GROQ_API_KEY)
        completion = client.chat.completions.create(
            model=config.GROQ_MODEL,
            messages=_messages_for_chat(
                message,
                history,
                bot_name,
                user_name,
                personality_preset=personality_preset,
                personality_custom=personality_custom,
                session_summary=session_summary,
            ),
            temperature=config.AI_TEMPERATURE,
            max_completion_tokens=800,
        )
        return completion.choices[0].message.content

    return await asyncio.to_thread(run)


async def _generate_openai(
    message: str,
    history: list[dict],
    bot_name: str | None = None,
    user_name: str | None = None,
    personality_preset: str | None = None,
    personality_custom: str | None = None,
    session_summary: str | None = None,
):
    from openai import OpenAI

    def run():
        client = OpenAI(base_url=config.OPENAI_BASE_URL, api_key=config.OPENAI_API_KEY)
        completion = client.chat.completions.create(
            model=config.OPENAI_MODEL,
            messages=_messages_for_chat(
                message,
                history,
                bot_name,
                user_name,
                personality_preset=personality_preset,
                personality_custom=personality_custom,
                session_summary=session_summary,
            ),
            temperature=config.AI_TEMPERATURE,
        )
        return completion.choices[0].message.content

    return await asyncio.to_thread(run)


async def _generate_ollama(
    message: str,
    history: list[dict],
    bot_name: str | None = None,
    user_name: str | None = None,
    personality_preset: str | None = None,
    personality_custom: str | None = None,
    session_summary: str | None = None,
):
    def run():
        response = requests.post(
            f"{config.OLLAMA_URL}/api/chat",
            json={
                "model": config.OLLAMA_MODEL,
                "messages": _messages_for_chat(
                    message,
                    history,
                    bot_name,
                    user_name,
                    personality_preset=personality_preset,
                    personality_custom=personality_custom,
                    session_summary=session_summary,
                ),
                "stream": False,
                "options": {"temperature": config.AI_TEMPERATURE},
            },
            timeout=120,
        )
        response.raise_for_status()
        return response.json()["message"]["content"]

    return await asyncio.to_thread(run)
