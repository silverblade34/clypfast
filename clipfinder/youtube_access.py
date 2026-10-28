"""Explicitly configured authentication for YouTube downloads."""

import os
import re
from pathlib import Path
from urllib.parse import urlparse


class YoutubeSessionRequired(RuntimeError):
    """A download needs an explicitly selected browser session."""


def youtube_options(source: str, browser_override: str | None = None) -> dict:
    host = (urlparse(source).hostname or "").lower()
    if not (host == "youtu.be" or host == "youtube.com" or host.endswith(".youtube.com")):
        return {}
    options = {"nocolor": True}
    if browser_override is not None:
        if browser_override not in {"brave", "chrome", "edge", "firefox", "safari"}:
            raise ValueError("Navegador no válido para la sesión de YouTube.")
        return {**options, "cookiesfrombrowser": (browser_override,)}
    cookie_file = os.getenv("CLIPFINDER_YOUTUBE_COOKIES_FILE", "").strip()
    browser = os.getenv("CLIPFINDER_YOUTUBE_COOKIES_BROWSER", "").strip().lower()
    if cookie_file:
        path = Path(cookie_file).expanduser()
        if not path.is_file():
            raise ValueError("No existe el archivo configurado en CLIPFINDER_YOUTUBE_COOKIES_FILE.")
        options["cookiefile"] = str(path)
    elif browser:
        if browser not in {"brave", "chrome", "chromium", "edge", "firefox", "opera", "safari", "vivaldi", "whale"}:
            raise ValueError("Navegador no válido en CLIPFINDER_YOUTUBE_COOKIES_BROWSER.")
        options["cookiesfrombrowser"] = (browser,)
    return options


def clean_download_error(error: Exception) -> str:
    return re.sub(r"\x1b\[[0-?]*[ -/]*[@-~]", "", str(error))


def requires_youtube_login(error: Exception) -> bool:
    message = clean_download_error(error).lower()
    return "sign in" in message or "not a bot" in message or "too many requests" in message


def download_error_message(error: Exception) -> str:
    if requires_youtube_login(error):
        return (
            "YouTube bloqueó la descarga y solicita verificar tu sesión. "
            "Configura CLIPFINDER_YOUTUBE_COOKIES_BROWSER=brave con YouTube abierto "
            "y la sesión iniciada, o CLIPFINDER_YOUTUBE_COOKIES_FILE, y reinicia el backend."
        )
    return clean_download_error(error)
