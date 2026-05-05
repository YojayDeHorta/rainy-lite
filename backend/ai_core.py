import asyncio
import re

import requests

from . import config
from .memory import get_memories
from .prompts import LOCAL_FALLBACK_REPLY, RAINY_SYSTEM_PROMPT


def clean_response(text: str) -> str:
    text = re.sub(r"<think>.*?</think>", "", text or "", flags=re.DOTALL).strip()
    if not re.match(r"^\[(NEUTRAL|HAPPY|SAD|SURPRISED|THINKING|SHY)\]", text, re.I):
        text = f"[NEUTRAL] {text}" if text else LOCAL_FALLBACK_REPLY
    return text


def _messages_for_chat(message: str, history: list[dict]):
    memories = get_memories()
    memory_block = ""
    if memories:
        memory_block = "\nMemorias del usuario:\n" + "\n".join(f"- {item}" for item in memories)

    messages = [{"role": "system", "content": RAINY_SYSTEM_PROMPT + memory_block}]
    for item in history[-20:]:
        role = "assistant" if item["role"] == "assistant" else "user"
        messages.append({"role": role, "content": item["content"]})
    messages.append({"role": "user", "content": message})
    return messages


async def generate_response(message: str, history: list[dict]):
    provider = config.AI_PROVIDER
    if provider == "gemini" and config.GEMINI_KEY:
        return clean_response(await _generate_gemini(message, history))
    if provider == "groq" and config.GROQ_API_KEY:
        return clean_response(await _generate_groq(message, history))
    if provider == "openai" and config.OPENAI_API_KEY:
        return clean_response(await _generate_openai(message, history))
    if provider == "ollama":
        return clean_response(await _generate_ollama(message, history))
    return LOCAL_FALLBACK_REPLY


async def _generate_gemini(message: str, history: list[dict]):
    import google.generativeai as genai

    def run():
        genai.configure(api_key=config.GEMINI_KEY)
        model = genai.GenerativeModel(config.AI_MODEL, system_instruction=RAINY_SYSTEM_PROMPT)
        gemini_history = []
        for item in history[-20:]:
            role = "model" if item["role"] == "assistant" else "user"
            gemini_history.append({"role": role, "parts": [{"text": item["content"]}]})
        chat = model.start_chat(history=gemini_history)
        response = chat.send_message(message)
        return response.text

    return await asyncio.to_thread(run)


async def _generate_groq(message: str, history: list[dict]):
    from groq import Groq

    def run():
        client = Groq(api_key=config.GROQ_API_KEY)
        completion = client.chat.completions.create(
            model=config.GROQ_MODEL,
            messages=_messages_for_chat(message, history),
            temperature=config.AI_TEMPERATURE,
            max_completion_tokens=800,
        )
        return completion.choices[0].message.content

    return await asyncio.to_thread(run)


async def _generate_openai(message: str, history: list[dict]):
    from openai import OpenAI

    def run():
        client = OpenAI(base_url=config.OPENAI_BASE_URL, api_key=config.OPENAI_API_KEY)
        completion = client.chat.completions.create(
            model=config.OPENAI_MODEL,
            messages=_messages_for_chat(message, history),
            temperature=config.AI_TEMPERATURE,
        )
        return completion.choices[0].message.content

    return await asyncio.to_thread(run)


async def _generate_ollama(message: str, history: list[dict]):
    def run():
        response = requests.post(
            f"{config.OLLAMA_URL}/api/chat",
            json={
                "model": config.OLLAMA_MODEL,
                "messages": _messages_for_chat(message, history),
                "stream": False,
                "options": {"temperature": config.AI_TEMPERATURE},
            },
            timeout=120,
        )
        response.raise_for_status()
        return response.json()["message"]["content"]

    return await asyncio.to_thread(run)
