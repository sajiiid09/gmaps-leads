"""Google Maps scrape task (Botasaurus browser mode).

Flow: search → scroll feed until stall/limit → open each place → extract via
selectors.EXTRACT_DETAIL_JS → upsert by place_key. Politeness enforced throughout.
"""

import logging
import re
from urllib.parse import quote

from botasaurus.browser import Driver, browser

from app.config import settings
from app.scraper import selectors
from app.scraper.db_io import (
    derive_place_key,
    existing_place_key_ids,
    link_job_business,
    upsert_business,
)
from app.scraper.politeness import (
    BlockedError,
    DailyCapReached,
    check_blocked,
    check_daily_cap,
    polite_delay,
)

log = logging.getLogger(__name__)

MAPS_SEARCH_URL = "https://www.google.com/maps/search/{query}?hl=en"
MAX_SCROLL_ROUNDS = 60
STALL_ROUNDS = 3


def _force_english(url: str) -> str:
    if "hl=" in url:
        return re.sub(r"hl=[a-zA-Z-]+", "hl=en", url)
    sep = "&" if "?" in url else "?"
    return f"{url}{sep}hl=en"


def _assert_not_blocked(driver: Driver) -> None:
    check_blocked(driver.current_url, driver.page_text or "")


def _collect_place_links(driver: Driver, max_results: int) -> list[str]:
    """Scroll the results feed until the link count stalls or max_results reached."""
    driver.wait_for_element(selectors.FEED, wait=15)
    stale = 0
    previous = 0
    for _ in range(MAX_SCROLL_ROUNDS):
        driver.scroll(selectors.FEED, by=4000)
        driver.sleep(2)
        count = len(driver.select_all(selectors.PLACE_LINK, wait=None))
        if count >= max_results:
            break
        stale = stale + 1 if count == previous else 0
        if stale >= STALL_ROUNDS:
            log.info("feed exhausted at %d results", count)
            break
        previous = count
    links = []
    seen = set()
    for el in driver.select_all(selectors.PLACE_LINK, wait=None):
        href = el.href
        if href and href not in seen:
            seen.add(href)
            links.append(href)
    return links[:max_results]


def _text(driver: Driver, selector: str) -> str | None:
    el = driver.select(selector, wait=None)
    text = el.text if el else None
    return text.strip() if text else None


def _extract_detail(driver: Driver) -> dict:
    driver.wait_for_element(selectors.NAME, wait=15)

    website_el = driver.select(selectors.WEBSITE, wait=None)
    phone_el = driver.select(selectors.PHONE, wait=None)
    phone = None
    if phone_el:
        phone = (phone_el.get_attribute("data-item-id") or "").replace(
            "phone:tel:", ""
        ) or None

    rating = reviews_count = None
    rating_el = driver.select(selectors.RATING_CONTAINER, wait=None)
    if rating_el:
        blob = (rating_el.html or "").replace("\xa0", " ")
        m = re.search(r">([0-9][.,][0-9])<", blob)
        if m:
            rating = float(m.group(1).replace(",", "."))
        m = re.search(r"\(([\d.,\s]+)\)", blob)
        if m:
            digits = re.sub(r"[^\d]", "", m.group(1))
            reviews_count = int(digits) if digits else None

    return {
        "name": _text(driver, selectors.NAME),
        "main_category": _text(driver, selectors.CATEGORY),
        "address": _text(driver, selectors.ADDRESS),
        "website": website_el.get_attribute("href") if website_el else None,
        "phone": phone,
        "rating": rating,
        "reviews_count": reviews_count,
        "url": driver.current_url,
    }


@browser(
    headless=settings.scrape_headless,
    block_images=True,
    reuse_driver=True,
    output=None,
    close_on_crash=True,
)
def scrape_maps_query(driver: Driver, data: dict):
    """data: {"query": str, "city": str, "max_results": int, "job_id": int | None}"""
    query = data["query"]
    city = data.get("city")
    max_results = int(data.get("max_results", 120))
    job_id = data.get("job_id")

    driver.google_get(
        MAPS_SEARCH_URL.format(query=quote(query)), accept_google_cookies=True
    )
    _assert_not_blocked(driver)

    links = _collect_place_links(driver, max_results)
    log.info("query %r: %d place links collected", query, len(links))

    known = existing_place_key_ids()
    scraped, skipped = 0, 0
    results = []
    for href in links:
        place_key = derive_place_key(href, None, None)
        if place_key in known:
            # already scraped by an earlier job — still record that this job found it
            link_job_business(job_id, known[place_key])
            skipped += 1
            continue

        check_daily_cap()
        polite_delay()

        href = _force_english(href)
        driver.get(href)
        _assert_not_blocked(driver)
        raw = _extract_detail(driver)
        if not raw.get("name"):
            log.warning("no name extracted at %s — selector rot? skipping", href)
            continue

        record = {
            "place_key": derive_place_key(
                raw.get("url") or href, raw.get("name"), raw.get("address")
            ),
            "name": raw["name"],
            "main_category": raw.get("main_category"),
            "categories": [raw["main_category"]] if raw.get("main_category") else None,
            "address": raw.get("address"),
            "city": city,
            "phone": raw.get("phone"),
            "website": raw.get("website"),
            "rating": raw.get("rating"),
            "reviews_count": raw.get("reviews_count"),
            "raw": raw,
            "source_query": query,
        }
        business_id = upsert_business(record)
        known[record["place_key"]] = business_id
        link_job_business(job_id, business_id)
        scraped += 1
        results.append(record["name"])
        log.info("saved [%d]: %s", scraped, raw["name"])

    return {"query": query, "scraped": scraped, "skipped_existing": skipped}


def run_query(
    query: str, city: str | None, max_results: int, job_id: int | None = None
) -> dict:
    """Wrapper handling politeness exceptions into a result dict."""
    try:
        return scrape_maps_query(
            {"query": query, "city": city, "max_results": max_results, "job_id": job_id}
        )
    except BlockedError as e:
        log.error("BLOCKED: %s", e)
        return {"query": query, "blocked": True, "error": str(e)}
    except DailyCapReached as e:
        log.warning("cap: %s", e)
        return {"query": query, "cap_reached": True, "error": str(e)}
