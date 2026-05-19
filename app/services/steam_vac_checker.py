"""VAC/Game Ban and Limited Account status checker via Steam Help Portal."""

import json

from bs4 import BeautifulSoup
from loguru import logger


async def check_vac_and_limit(steam) -> tuple[str, str, list[str]]:
    """Check VAC/Game ban and limited account status from /wizard/VacBans.

    Single authenticated GET, parses both statuses and banned game names.

    Returns:
        tuple[str, str, list[str]]:
            - vac_status:   'VAC' | 'GAME BAN' | 'CLEAN' | ''
            - limit_status: 'Lim' | 'NoLim' | ''
            - vac_games:    list of banned game names (may be empty)
    """
    try:
        response_html = await steam.request(
            "https://help.steampowered.com/en/wizard/VacBans",
            method="GET",
        )

        if isinstance(response_html, bytes):
            response_html = response_html.decode("utf-8", errors="replace")

        soup = BeautifulSoup(response_html, "html.parser")

        limit_status = "Lim" if soup.find("div", class_="help_event_limiteduser") else "NoLim"

        vac_status = "CLEAN"
        vac_games: list[str] = []

        vac_body = soup.find("div", class_="vac_body")
        if vac_body:
            ban_header = vac_body.find("div", class_="vac_ban_header")
            if ban_header:
                header_text = ban_header.get_text(strip=True).lower()
                if "game developer" in header_text or "game ban" in header_text:
                    vac_status = "GAME BAN"
                    for box in vac_body.find_all("div", class_="refund_info_box"):
                        for span in box.find_all("span", class_="help_highlight_text"):
                            name = span.get_text(strip=True)
                            if name:
                                vac_games.append(name)
                else:
                    vac_status = "VAC"

        return vac_status, limit_status, vac_games

    except Exception as exc:
        logger.warning(f"VAC/limit check failed: {exc}")
        return "", "", []
