"""Parses wallet balance and country from store.steampowered.com/account/."""

import re

from bs4 import BeautifulSoup
from loguru import logger

# fmt: off
_COUNTRY_NAME_TO_ISO2: dict[str, str] = {
    "afghanistan": "AF", "albania": "AL", "algeria": "DZ", "andorra": "AD",
    "angola": "AO", "argentina": "AR", "armenia": "AM", "australia": "AU",
    "austria": "AT", "azerbaijan": "AZ", "bahrain": "BH", "bangladesh": "BD",
    "belarus": "BY", "belgium": "BE", "bolivia": "BO", "bosnia and herzegovina": "BA",
    "brazil": "BR", "bulgaria": "BG", "cambodia": "KH", "canada": "CA",
    "chile": "CL", "china": "CN", "colombia": "CO", "costa rica": "CR",
    "croatia": "HR", "cyprus": "CY", "czech republic": "CZ", "czechia": "CZ",
    "denmark": "DK", "ecuador": "EC", "egypt": "EG", "estonia": "EE",
    "ethiopia": "ET", "finland": "FI", "france": "FR", "georgia": "GE",
    "germany": "DE", "ghana": "GH", "greece": "GR", "guatemala": "GT",
    "honduras": "HN", "hong kong": "HK", "hungary": "HU", "iceland": "IS",
    "india": "IN", "indonesia": "ID", "iran": "IR", "iraq": "IQ",
    "ireland": "IE", "israel": "IL", "italy": "IT", "jamaica": "JM",
    "japan": "JP", "jordan": "JO", "kazakhstan": "KZ", "kenya": "KE",
    "kuwait": "KW", "kyrgyzstan": "KG", "latvia": "LV", "lebanon": "LB",
    "liechtenstein": "LI", "lithuania": "LT", "luxembourg": "LU",
    "malaysia": "MY", "malta": "MT", "mexico": "MX", "moldova": "MD",
    "mongolia": "MN", "morocco": "MA", "netherlands": "NL", "new zealand": "NZ",
    "nicaragua": "NI", "nigeria": "NG", "north macedonia": "MK", "norway": "NO",
    "oman": "OM", "pakistan": "PK", "panama": "PA", "paraguay": "PY",
    "peru": "PE", "philippines": "PH", "poland": "PL", "portugal": "PT",
    "qatar": "QA", "romania": "RO", "russia": "RU", "russian federation": "RU",
    "saudi arabia": "SA", "serbia": "RS", "singapore": "SG", "slovakia": "SK",
    "slovenia": "SI", "south africa": "ZA", "south korea": "KR",
    "republic of korea": "KR", "spain": "ES", "sri lanka": "LK", "sweden": "SE",
    "switzerland": "CH", "taiwan": "TW", "tajikistan": "TJ", "thailand": "TH",
    "tunisia": "TN", "turkey": "TR", "turkmenistan": "TM", "ukraine": "UA",
    "united arab emirates": "AE", "united kingdom": "GB",
    "united states": "US", "uruguay": "UY", "uzbekistan": "UZ",
    "venezuela": "VE", "vietnam": "VN",
}
# fmt: on


def _name_to_iso2(name: str) -> str:
    """Convert a country name to ISO 3166-1 alpha-2 code, or return the name unchanged."""
    return _COUNTRY_NAME_TO_ISO2.get(name.strip().lower(), name)


def _parse_balance_and_country_html(html: str) -> tuple[str, str]:
    """Parse balance and country from store.steampowered.com/account/ HTML."""
    soup = BeautifulSoup(html, "html.parser")

    balance = ""
    balance_row = soup.find("div", class_="accountBalance")
    if balance_row:
        price_div = balance_row.find("div", class_="price")
        if price_div:
            balance = price_div.get_text(strip=True)

    country = ""
    # Look inside country_settings div first (most reliable)
    country_block = soup.find("div", class_="country_settings")
    if country_block:
        span = country_block.find("span", class_="account_data_field")
        if span:
            country = _name_to_iso2(span.get_text(strip=True))

    # Fallback: any <p> containing "Country:" label
    if not country:
        for p in soup.find_all("p"):
            text = p.get_text()
            if "Country:" in text or "Страна:" in text:
                span = p.find("span", class_="account_data_field")
                if span:
                    country = _name_to_iso2(span.get_text(strip=True))
                    break

    # Last resort: look for 2-letter code in embedded JS
    if not country:
        for pattern in [
            r'"userCountry"\s*:\s*"([A-Z]{2})"',
            r'g_strCountryCode\s*=\s*"([A-Z]{2})"',
        ]:
            m = re.search(pattern, html)
            if m:
                country = m.group(1)
                break

    return balance, country


async def fetch_balance_and_country(steam) -> tuple[str, str]:
    """Fetch wallet balance and country using a pysteamauth steam session."""
    try:
        html = await steam.request("https://store.steampowered.com/account/", method="GET")
        if isinstance(html, bytes):
            html = html.decode("utf-8", errors="replace")
        return _parse_balance_and_country_html(html)
    except Exception as exc:
        logger.warning(f"Balance/country fetch failed: {exc}")
        return "", ""


async def fetch_balance_and_country_aiohttp(session, jar) -> tuple[str, str]:  # noqa: ARG001
    """Fetch wallet balance and country using an aiohttp ClientSession."""
    import aiohttp

    try:
        async with session.get(
            "https://store.steampowered.com/account/",
            timeout=aiohttp.ClientTimeout(total=15),
        ) as resp:
            html = await resp.text()
        return _parse_balance_and_country_html(html)
    except Exception as exc:
        logger.warning(f"Balance/country aiohttp fetch failed: {exc}")
        return "", ""
