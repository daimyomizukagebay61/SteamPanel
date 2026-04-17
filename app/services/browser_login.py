import asyncio
import json

from loguru import logger

_active_browsers: list = []

STEAM_DOMAINS = [
    ".steamcommunity.com",
    ".steampowered.com",
    ".store.steampowered.com",
    ".help.steampowered.com",
    ".login.steampowered.com",
]


async def open_browser_with_cookies(account: dict) -> None:
    """Open a Chrome browser with Steam session cookies using nodriver."""
    import nodriver as uc

    cookies_json = account.get("session_cookies")
    if not cookies_json:
        raise ValueError("No session cookies saved. Validate the account first.")

    cookies = json.loads(cookies_json)

    browser = await uc.start()
    _active_browsers.append(browser)

    tab = await browser.get("about:blank")

    for c in cookies:
        domain = c.get("domain") or ".steamcommunity.com"
        domains_to_set = [domain]
        if "steam" in domain:
            domains_to_set = list(set([domain] + STEAM_DOMAINS))

        for d in domains_to_set:
            try:
                await tab.send(uc.cdp.network.set_cookie(
                    name=c["name"],
                    value=c["value"],
                    domain=d,
                    path=c.get("path") or "/",
                    secure=c.get("secure", True),
                    http_only=c.get("httpOnly", False),
                ))
            except Exception:
                pass

    steam_id = account.get("steam_id") or ""
    if steam_id:
        start_url = f"https://steamcommunity.com/profiles/{steam_id}/"
    else:
        start_url = "https://steamcommunity.com/"
    await browser.get(start_url)
    logger.info(f"Browser opened for {account['login']}")

    # Wait until browser is closed by user, suppress connection errors
    try:
        while browser:
            await asyncio.sleep(1)
            try:
                if not browser.connection or browser.connection.closed:
                    break
            except Exception:
                break
    except Exception:
        pass
    finally:
        if browser in _active_browsers:
            _active_browsers.remove(browser)

        # Temporarily suppress nodriver's internal task errors during cleanup
        # (Browser.update_targets() raises ConnectionRefusedError after close)
        loop = asyncio.get_running_loop()
        _original_handler = loop.get_exception_handler()

        def _suppress_nodriver_close_errors(loop, context):
            exc = context.get("exception")
            if isinstance(exc, (ConnectionRefusedError, ConnectionResetError, OSError)):
                return
            if _original_handler:
                _original_handler(loop, context)
            else:
                loop.default_exception_handler(context)

        loop.set_exception_handler(_suppress_nodriver_close_errors)
        try:
            browser.stop()
        except Exception:
            pass
        await asyncio.sleep(0.5)
        loop.set_exception_handler(_original_handler)

        logger.debug(f"Browser closed for {account['login']}")
