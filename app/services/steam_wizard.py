"""Shared Steam account recovery wizard flow.

Steps 1-9 are identical across password change, email change, and phone removal.
This module extracts that common logic.
"""

import asyncio
import json
from dataclasses import dataclass
from urllib.parse import parse_qs, urlparse

from loguru import logger

from app.core.crypto import encrypt_password
from app.services.steam_auth import raw_request

BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/"
    "537.36 (KHTML, like Gecko) Chrome/83.0.4103.116 Safari/537.36"
)

AJAX_HEADERS = {
    "Accept": "*/*",
    "X-Requested-With": "XMLHttpRequest",
    "User-Agent": BROWSER_UA,
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    "Origin": "https://help.steampowered.com",
}


@dataclass
class WizardParams:
    s: int
    account: int
    reset: int
    issueid: int
    lost: int = 0
    sessionid: str = ""


async def parse_wizard_redirect(steam, entry_url: str) -> WizardParams:
    """Step 1-2: Navigate to wizard entry URL, follow redirects, parse params from final URL."""
    logger.debug(f"[Wizard] Step 1-2: GET {entry_url}")
    response = await raw_request(
        steam,
        url=entry_url,
        method="GET",
        headers={"User-Agent": BROWSER_UA},
        allow_redirects=True,
    )
    final_url = str(response.url)
    logger.debug(f"[Wizard] Redirect → {final_url}")
    query = parse_qs(urlparse(final_url).query)

    sessionid = await steam.sessionid("help.steampowered.com")

    params = WizardParams(
        s=int(query.get("s", [0])[0]),
        account=int(query.get("account", [0])[0]),
        reset=int(query.get("reset", [0])[0]),
        issueid=int(query.get("issueid", [0])[0]),
        lost=int(query.get("lost", [0])[0]),
        sessionid=sessionid,
    )
    logger.debug(f"[Wizard] Parsed: s={params.s}, account={params.account}, reset={params.reset}, issueid={params.issueid}")
    return params


async def login_info_enter_code(steam, params: WizardParams) -> dict:
    """Step 3: Enter code mode."""
    logger.debug("[Wizard] Step 3: HelpWithLoginInfoEnterCode")
    text = await steam.request(
        url="https://help.steampowered.com/en/wizard/HelpWithLoginInfoEnterCode",
        method="GET",
        params={
            "s": params.s,
            "account": params.account,
            "reset": params.reset,
            "lost": params.lost,
            "issueid": params.issueid,
            "sessionid": params.sessionid,
            "wizard_ajax": 1,
            "gamepad": 0,
        },
        headers=AJAX_HEADERS,
    )
    result = json.loads(text) if isinstance(text, str) else text
    logger.debug(f"[Wizard] Step 3 response: {result}")
    return result


async def send_recovery_code(steam, params: WizardParams) -> dict:
    """Step 4: Send account recovery code (method=8 = mobile app)."""
    logger.debug("[Wizard] Step 4: AjaxSendAccountRecoveryCode (method=8, mobile)")
    text = await steam.request(
        url="https://help.steampowered.com/en/wizard/AjaxSendAccountRecoveryCode",
        method="POST",
        data={
            "s": params.s,
            "account": params.account,
            "reset": params.reset,
            "lost": params.lost,
            "issueid": params.issueid,
            "sessionid": params.sessionid,
            "wizard_ajax": 1,
            "gamepad": 0,
            "method": 8,
            "link": "",
            "n": 1,
        },
        headers=AJAX_HEADERS,
    )
    result = json.loads(text) if isinstance(text, str) else text
    logger.debug(f"[Wizard] Step 4 response: {result}")
    if result.get("errorMsg"):
        raise RuntimeError(f"SendRecoveryCode failed: {result['errorMsg']}")
    return result


async def mobile_confirm(steam, params: WizardParams, retries: int = 5) -> None:
    """Step 5: Confirm via Steam mobile confirmations API (getlist → find by creator_id → ajaxop allow)."""
    logger.debug("[Wizard] Step 5: Mobile confirmation")

    try:
        sid = steam.steamid
    except (ValueError, AttributeError):
        sid = None
    if not sid:
        raise RuntimeError("No steamid on Steam object — cannot perform mobile confirmation")

    try:
        did = steam.device_id
    except (ValueError, AttributeError):
        did = None
    if not did:
        raise RuntimeError("No device_id on Steam object — cannot perform mobile confirmation")

    try:
        _ = steam.identity_secret
    except (ValueError, AttributeError):
        raise RuntimeError("No identity_secret on Steam object — cannot perform mobile confirmation")

    logger.debug(f"[MobileConfirm] steamid={sid}, device_id={did[:20]}..., creator_id(s)={params.s}")

    # Steam needs time to create the confirmation after send_recovery_code
    logger.debug("[MobileConfirm] Waiting 3s for Steam to create confirmation...")
    await asyncio.sleep(3)

    for attempt in range(retries):
        try:
            server_time = await steam.get_server_time()
            conf_hash = steam.get_confirmation_hash(server_time=server_time)
            logger.debug(f"[MobileConfirm] Attempt {attempt + 1}/{retries}: getlist (server_time={server_time})")

            conf_text = await steam.request(
                url="https://steamcommunity.com/mobileconf/getlist",
                method="GET",
                cookies={
                    "mobileClient": "ios",
                    "mobileClientVersion": "2.0.20",
                    "steamid": str(sid),
                    "Steam_Language": "english",
                },
                params={
                    "p": did,
                    "a": str(sid),
                    "k": conf_hash,
                    "t": server_time,
                    "m": "react",
                    "tag": "conf",
                },
            )
            conf_data = json.loads(conf_text) if isinstance(conf_text, str) else conf_text

            confs = conf_data.get("conf", [])
            logger.debug(f"[MobileConfirm] getlist response: success={conf_data.get('success')}, {len(confs)} confirmation(s)")
            for i, c in enumerate(confs):
                logger.debug(
                    f"[MobileConfirm]   [{i}] id={c.get('id')}, type={c.get('type')}, "
                    f"type_name={c.get('type_name', '?')}, creator_id={c.get('creator_id')}, "
                    f"headline={c.get('headline', '')}"
                )

            if not conf_data.get("success"):
                logger.warning(f"[MobileConfirm] getlist failed: {conf_data}")
                raise RuntimeError(f"getlist failed: {conf_data}")

            target = None
            creator = str(params.s)
            for c in confs:
                if str(c.get("creator_id", "")) == creator:
                    target = c
                    break

            if not target:
                ids = [str(c.get("creator_id", "")) for c in confs]
                logger.warning(f"[MobileConfirm] No match for creator_id={creator}, available: {ids}")
                raise RuntimeError(f"No confirmation found for creator_id={creator}")

            logger.debug(
                f"[MobileConfirm] Found match! id={target['id']}, nonce={target.get('nonce')}, "
                f"creator_id={target.get('creator_id')}"
            )

            allow_time = await steam.get_server_time()
            allow_hash = steam.get_confirmation_hash(server_time=allow_time, tag="allow")
            logger.debug(f"[MobileConfirm] Calling ajaxop allow (server_time={allow_time})")

            allow_text = await steam.request(
                url="https://steamcommunity.com/mobileconf/ajaxop",
                method="GET",
                cookies={
                    "mobileClient": "ios",
                    "mobileClientVersion": "2.0.20",
                },
                params={
                    "op": "allow",
                    "p": did,
                    "a": str(sid),
                    "k": allow_hash,
                    "t": allow_time,
                    "m": "react",
                    "tag": "allow",
                    "cid": target["id"],
                    "ck": target["nonce"],
                },
            )
            allow_data = json.loads(allow_text) if isinstance(allow_text, str) else allow_text
            logger.debug(f"[MobileConfirm] ajaxop response: {allow_data}")

            if allow_data.get("success"):
                logger.debug(f"[MobileConfirm] ✓ Confirmation accepted (attempt {attempt + 1})")
                return
            raise RuntimeError(f"ajaxop returned success=false: {allow_data}")

        except Exception as exc:
            logger.warning(f"[MobileConfirm] Attempt {attempt + 1}/{retries} failed: {exc}")
            if attempt < retries - 1:
                logger.debug(f"[MobileConfirm] Retrying in 3s...")
                await asyncio.sleep(3)

    raise RuntimeError(f"Mobile confirmation failed after {retries} retries")


async def poll_recovery_confirmation(steam, params: WizardParams) -> dict:
    """Step 6: Poll account recovery confirmation (single call, matches old chemail.py)."""
    logger.debug("[Wizard] Step 6: AjaxPollAccountRecoveryConfirmation")
    text = await steam.request(
        url="https://help.steampowered.com/en/wizard/AjaxPollAccountRecoveryConfirmation",
        method="POST",
        data={
            "s": params.s,
            "reset": params.reset,
            "lost": params.lost,
            "issueid": params.issueid,
            "sessionid": params.sessionid,
            "wizard_ajax": 1,
            "gamepad": 0,
            "method": 8,
        },
        headers=AJAX_HEADERS,
    )
    data = json.loads(text) if isinstance(text, str) else text
    logger.debug(f"[Wizard] Step 6 response: {data}")
    if data.get("errorMsg"):
        raise RuntimeError(f"Poll error from Steam: {data['errorMsg']}")
    return data


async def verify_recovery_code(steam, params: WizardParams) -> dict:
    """Step 7: Verify recovery code (empty for mobile method)."""
    logger.debug("[Wizard] Step 7: AjaxVerifyAccountRecoveryCode (code=empty, method=8)")
    text = await steam.request(
        url="https://help.steampowered.com/en/wizard/AjaxVerifyAccountRecoveryCode",
        method="GET",
        params={
            "code": "",
            "s": params.s,
            "reset": params.reset,
            "lost": params.lost,
            "method": 8,
            "issueid": params.issueid,
            "sessionid": params.sessionid,
            "wizard_ajax": 1,
            "gamepad": 0,
        },
        headers=AJAX_HEADERS,
    )
    result = json.loads(text) if isinstance(text, str) else text
    logger.debug(f"[Wizard] Step 7 response: {result}")
    if result.get("errorMsg"):
        raise RuntimeError(f"Step 7 (VerifyRecoveryCode) failed: {result['errorMsg']}")
    return result


async def get_next_step(steam, params: WizardParams) -> dict:
    """Step 8: Get next wizard step (lost=2 hardcoded)."""
    logger.debug("[Wizard] Step 8: AjaxAccountRecoveryGetNextStep (lost=2)")
    text = await steam.request(
        url="https://help.steampowered.com/en/wizard/AjaxAccountRecoveryGetNextStep",
        method="POST",
        data={
            "s": params.s,
            "account": params.account,
            "reset": params.reset,
            "lost": 2,
            "issueid": params.issueid,
            "sessionid": params.sessionid,
            "wizard_ajax": 1,
            "gamepad": 0,
        },
        headers=AJAX_HEADERS,
    )
    result = json.loads(text) if isinstance(text, str) else text
    logger.debug(f"[Wizard] Step 8 response: {result}")
    if result.get("errorMsg"):
        raise RuntimeError(f"Step 8 (GetNextStep) failed: {result['errorMsg']}")
    return result


async def get_rsa_key(steam, login: str) -> tuple[str, str, int]:
    """Step 9a: Get RSA public key from Steam."""
    logger.debug(f"[Wizard] Getting RSA key for {login}")
    sessionid = await steam.sessionid("help.steampowered.com")
    text = await steam.request(
        url="https://help.steampowered.com/en/login/getrsakey/",
        method="POST",
        data={
            "sessionid": sessionid,
            "username": login,
        },
        headers=AJAX_HEADERS,
    )
    data = json.loads(text) if isinstance(text, str) else text
    logger.debug(f"[Wizard] RSA key received: success={data.get('success')}, timestamp={data.get('timestamp')}")
    return data["publickey_mod"], data["publickey_exp"], int(data["timestamp"])


async def verify_password(steam, params: WizardParams, login: str, password: str) -> dict:
    """Step 9: Verify current password via RSA encryption."""
    logger.debug(f"[Wizard] Step 9: Verifying current password for {login}")
    mod, exp, timestamp = await get_rsa_key(steam, login)
    encrypted = encrypt_password(password, mod, exp)
    sessionid = await steam.sessionid("help.steampowered.com")

    text = await steam.request(
        url="https://help.steampowered.com/en/wizard/AjaxAccountRecoveryVerifyPassword/",
        method="POST",
        data={
            "sessionid": sessionid,
            "s": params.s,
            "lost": 2,
            "reset": 1,
            "password": encrypted,
            "rsatimestamp": timestamp,
        },
        headers=AJAX_HEADERS,
    )
    result = json.loads(text) if isinstance(text, str) else text
    logger.debug(f"[Wizard] Step 9 response: {result}")
    if result.get("errorMsg"):
        raise RuntimeError(f"Step 9 (VerifyPassword) failed: {result['errorMsg']}")
    return result


async def run_common_wizard(steam, entry_url: str, login: str, password: str) -> WizardParams:
    """Execute the full shared wizard flow (steps 1-9).

    Returns WizardParams ready for the service-specific final steps.
    """
    logger.debug(f"[Wizard] ===== Starting wizard for {login} =====")
    logger.debug(f"[Wizard] Entry URL: {entry_url}")

    params = await parse_wizard_redirect(steam, entry_url)
    await asyncio.sleep(1)

    await login_info_enter_code(steam, params)
    await asyncio.sleep(1)

    await send_recovery_code(steam, params)
    await asyncio.sleep(1)

    await mobile_confirm(steam, params)

    await poll_recovery_confirmation(steam, params)
    await asyncio.sleep(1)

    await verify_recovery_code(steam, params)
    await asyncio.sleep(1)

    await get_next_step(steam, params)
    await asyncio.sleep(1)

    await verify_password(steam, params, login, password)

    logger.debug(f"[Wizard] ===== Wizard complete for {login} =====")
    return params
