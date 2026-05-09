import base64
import time

import requests

from . import config

_token_cache = {"access_token": None, "expires_at": 0}


def _get_access_token():
    if not config.SPOTIFY_CLIENT_ID or not config.SPOTIFY_CLIENT_SECRET:
        raise RuntimeError(
            "Spotify no configurado. Agrega SPOTIFY_CLIENT_ID y SPOTIFY_CLIENT_SECRET al .env"
        )

    now = time.time()
    if _token_cache["access_token"] and _token_cache["expires_at"] > now + 30:
        return _token_cache["access_token"]

    credentials = base64.b64encode(
        f"{config.SPOTIFY_CLIENT_ID}:{config.SPOTIFY_CLIENT_SECRET}".encode()
    ).decode()

    resp = requests.post(
        "https://accounts.spotify.com/api/token",
        headers={
            "Authorization": f"Basic {credentials}",
            "Content-Type": "application/x-www-form-urlencoded",
        },
        data={"grant_type": "client_credentials"},
        timeout=10,
    )
    resp.raise_for_status()
    data = resp.json()

    _token_cache["access_token"] = data["access_token"]
    _token_cache["expires_at"] = now + data.get("expires_in", 3600)
    return _token_cache["access_token"]


def search_track(query, limit=5):
    if config.PROXY_URL:
        return _search_track_proxy(query, limit)
    token = _get_access_token()

    resp = requests.get(
        "https://api.spotify.com/v1/search",
        headers={"Authorization": f"Bearer {token}"},
        params={"q": query, "type": "track", "limit": limit, "market": "US"},
        timeout=10,
    )
    resp.raise_for_status()
    data = resp.json()

    tracks = []
    for item in data.get("tracks", {}).get("items", []):
        artists = ", ".join(a["name"] for a in item.get("artists", []))
        tracks.append(
            {
                "id": item["id"],
                "uri": item["uri"],
                "name": item["name"],
                "artists": artists,
                "album": item.get("album", {}).get("name", ""),
                "duration_ms": item.get("duration_ms", 0),
                "preview_url": item.get("preview_url"),
            }
        )
    return tracks


def _search_track_proxy(query, limit=5):
    resp = requests.get(
        f"{config.PROXY_URL}/api/spotify/search",
        params={"q": query, "limit": limit},
        timeout=15,
    )
    resp.raise_for_status()
    return resp.json().get("tracks", [])
