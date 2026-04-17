"""Steam account ban/alert checking via supportmessages page."""

from loguru import logger


async def check_ban(steam) -> str:
    """Check if account has active bans/alerts.

    Returns: 'BANNED', 'NO BAN', or '' on error.
    """
    try:
        response_html = await steam.request(
            "https://store.steampowered.com/supportmessages/",
            method="GET",
        )

        if isinstance(response_html, bytes):
            response_html = response_html.decode("utf-8", errors="replace")

        if "support_message_page" in response_html or "This account has been locked" in response_html:
            return "BANNED"
        elif "It doesn't appear that you have any active account alerts" in response_html:
            return "NO BAN"
        else:
            return "NO BAN"

    except Exception as exc:
        logger.warning(f"Ban check failed: {exc}")
        return ""
