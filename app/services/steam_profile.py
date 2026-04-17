import re

import aiohttp
from loguru import logger


async def fetch_profile(steam_id: str, steam=None) -> dict | None:
    """Fetch persona name and avatar URL from Steam community profile page.

    If *steam* session is provided, uses authenticated cookies.
    Returns {"nickname": str, "avatar_url": str, "steam_level": int|None} or None on failure.
    """
    url = f"https://steamcommunity.com/profiles/{steam_id}/"
    try:
        if steam is not None:
            from app.services.steam_auth import raw_request
            resp = await raw_request(steam, url, method="GET", allow_redirects=True)
            if resp.status != 200:
                logger.warning(f"Profile fetch for {steam_id}: HTTP {resp.status}")
                return None
            html = await resp.text()
        else:
            headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
            async with aiohttp.ClientSession(headers=headers) as session:
                async with session.get(url, timeout=aiohttp.ClientTimeout(total=15)) as resp:
                    if resp.status != 200:
                        logger.warning(f"Profile fetch for {steam_id}: HTTP {resp.status}")
                        return None
                    html = await resp.text()
    except Exception as exc:
        logger.warning(f"Profile fetch error for {steam_id}: {exc}")
        return None

    nickname = _parse_persona_name(html)
    avatar_url = _parse_avatar(html)
    steam_level = _parse_level(html)
    last_online = _parse_last_online(html)

    if not nickname and not avatar_url:
        return None

    return {"nickname": nickname, "avatar_url": avatar_url, "steam_level": steam_level, "last_online": last_online}


def _parse_persona_name(html: str) -> str | None:
    # g_rgProfileData = {"personaname":"jeffreyoelze1999",...}
    m = re.search(r'"personaname"\s*:\s*"([^"]*)"', html)
    if m:
        return m.group(1)
    # Fallback: <span class="actual_persona_name">...</span>
    m = re.search(r'<span class="actual_persona_name">([^<]+)</span>', html)
    return m.group(1) if m else None


def _parse_avatar(html: str) -> str | None:
    # 1) g_rgProfileData JSON: {"avatarfull":"https://avatars.fastly.steamstatic.com/..."}
    m = re.search(r'"avatarfull"\s*:\s*"(https://[^"]+)"', html)
    if m:
        return m.group(1).replace("_full.jpg", "_medium.jpg")
    # 2) <meta property="og:image" content="https://avatars...">
    m = re.search(r'<meta\s+property="og:image"\s+content="(https://avatars[^"]+)"', html)
    if m:
        return m.group(1).replace("_full.jpg", "_medium.jpg")
    # 3) playerAvatarAutoSizeInner img
    m = re.search(r'playerAvatarAutoSizeInner[\s\S]{0,200}?<img[^>]+srcset="(https://[^"]+)"', html)
    if m:
        return m.group(1).replace("_full.jpg", "_medium.jpg")
    return None


def _parse_level(html: str) -> int | None:
    # <span class="friendPlayerLevelNum">100</span>
    m = re.search(r'<span\s+class="friendPlayerLevelNum">(\d+)</span>', html)
    return int(m.group(1)) if m else None


def _parse_last_online(html: str) -> str | None:
    # "Last Online X days ago" → "Xd", "X hrs ago" → "Xh", "X min ago" → "Xm"
    m = re.search(r'Last\s+Online[^<]{0,150}?(\d+)\s+day', html, re.IGNORECASE)
    if m:
        return f"{m.group(1)}d"
    m = re.search(r'Last\s+Online[^<]{0,150}?(\d+)\s+hr', html, re.IGNORECASE)
    if m:
        return f"{m.group(1)}h"
    m = re.search(r'Last\s+Online[^<]{0,150}?(\d+)\s+min', html, re.IGNORECASE)
    if m:
        return f"{m.group(1)}m"
    if re.search(r'Currently\s+(In-Game|Online)', html, re.IGNORECASE):
        return "online"
    return None
