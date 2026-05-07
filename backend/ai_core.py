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
):
    memories = get_memories()
    memory_block = ""
    if memories:
        memory_block = "\nMemorias del usuario:\n" + "\n".join(f"- {item}" for item in memories)

    system_text = build_system_prompt(
        bot_name,
        user_name,
        personality_preset=personality_preset,
        personality_custom=personality_custom,
    )
    messages = [{"role": "system", "content": system_text + memory_block}]
    for item in history[-20:]:
        role = "assistant" if item["role"] == "assistant" else "user"
        messages.append({"role": role, "content": item["content"]})
    messages.append({"role": "user", "content": message})
    return messages


async def generate_response(
    message: str,
    history: list[dict],
    bot_name: str | None = None,
    user_name: str | None = None,
    personality_preset: str | None = None,
    personality_custom: str | None = None,
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
            )
        )
    return LOCAL_FALLBACK_REPLY


async def generate_response_with_metadata(
    message: str,
    history: list[dict],
    bot_name: str | None = None,
    user_name: str | None = None,
    personality_preset: str | None = None,
    personality_custom: str | None = None,
):
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
        )
    elif provider == "groq" and config.GROQ_API_KEY:
        raw_response = await _generate_groq(
            message,
            history,
            bot_name,
            user_name,
            personality_preset=personality_preset,
            personality_custom=personality_custom,
        )
    elif provider == "openai" and config.OPENAI_API_KEY:
        raw_response = await _generate_openai(
            message,
            history,
            bot_name,
            user_name,
            personality_preset=personality_preset,
            personality_custom=personality_custom,
        )
    elif provider == "ollama":
        raw_response = await _generate_ollama(
            message,
            history,
            bot_name,
            user_name,
            personality_preset=personality_preset,
            personality_custom=personality_custom,
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
):
    import google.generativeai as genai

    def run():
        genai.configure(api_key=config.GEMINI_KEY)
        model = genai.GenerativeModel(
            config.AI_MODEL,
            system_instruction=build_system_prompt(
                bot_name,
                user_name,
                personality_preset=personality_preset,
                personality_custom=personality_custom,
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
                ),
                "stream": False,
                "options": {"temperature": config.AI_TEMPERATURE},
            },
            timeout=120,
        )
        response.raise_for_status()
        return response.json()["message"]["content"]

    return await asyncio.to_thread(run)
