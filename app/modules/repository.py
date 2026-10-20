import asyncio
import hashlib
import re
import urllib.parse
from typing import Any

from fastapi import APIRouter, HTTPException, Query, status
from scrapling.fetchers import Fetcher
from scrapling.parser import Adaptor

from app.config import settings
from app.envelope import error_response
from app.router_helper import cached_endpoint
from app.proxy import get_proxy

router = APIRouter(prefix="/v1/repository", tags=["repository"])

def parse_repository_items(html: str) -> list[dict[str, Any]]:
    page = Adaptor(html)
    items = []
    seen_urls = set()

    # Format baru (portal Laravel): kartu div.research-box1
    for box in page.css("div.research-box1"):
        title_links = box.css("h3.sidebar-title a")
        if not title_links:
            continue
        a = title_links[0]
        href = (a.attrib.get("href") or "").strip()
        title = " ".join(a.text.split()).strip()
        if not href or not title or len(title) < 5 or href in seen_urls:
            continue
        seen_urls.add(href)

        author = None
        smalls = box.css("small.text-muted")
        if smalls:
            try:
                author = " ".join(smalls[0].get_all_text().split()).strip()
            except AttributeError:
                author = " ".join(smalls[0].text.split()).strip()
            author = re.sub(r"^:\s*", "", author).strip(" ;") or None

        year = None
        try:
            box_text = " ".join(box.get_all_text().split())
        except AttributeError:
            box_text = " ".join(box.text.split())
        m_year = re.search(r"\b(\d{4})\b", box_text)
        if m_year:
            year = int(m_year.group(1))

        items.append({
            "id": href.rstrip("/").split("/")[-1] or hashlib.sha256(href.encode()).hexdigest()[:12],
            "title": title,
            "author": author,
            "year": year,
            "url": href if href.startswith("http") else f"https://repository.bsi.ac.id{href}",
        })

    # Fallback format lama (EPrints) bila portal masih memakainya
    if not items:
        for el in page.css("div.ep_view_blurb, p.ep_view_blurb, div.ep_search_results"):
            for a in el.css("a"):
                href = a.attrib.get("href", "").strip()
                title = " ".join(a.text.split()).strip()
                if href and title and len(title) > 5 and href not in seen_urls:
                    seen_urls.add(href)
                    m_id = re.search(r"/(\d+)/?", href)
                    item_id = m_id.group(1) if m_id else hashlib.sha256(href.encode()).hexdigest()[:12]

                    m_year = re.search(r"\((\d{4})\)", el.text)
                    year = int(m_year.group(1)) if m_year else None

                    items.append({
                        "id": item_id,
                        "title": title,
                        "author": None,
                        "year": year,
                        "url": href if href.startswith("http") else f"https://repository.bsi.ac.id{href}",
                    })

    if not items:
        for a in page.css('a[href*="/viewitem/"], a[href*="/view/"], a[href*="/id/eprint/"], a[href*="/repo/"]'):
            href = a.attrib.get("href", "").strip()
            title = " ".join(a.text.split()).strip()
            m_id = re.search(r"/repo/(\d+)/?", href) or re.search(r"/(\d+)/?", href)
            if href and title and len(title) > 5 and href not in seen_urls and m_id:
                seen_urls.add(href)
                items.append({
                    "id": m_id.group(1),
                    "title": title,
                    "author": None,
                    "year": None,
                    "url": href if href.startswith("http") else f"https://repository.bsi.ac.id{href}",
                })

    return items

class RepositoryClient:
    BASE_URL = "https://repository.bsi.ac.id"

    def fetch_recent(self) -> str:
        url = f"{self.BASE_URL}/"
        try:
            res = Fetcher.get(url, timeout=30, impersonate="chrome", proxy=get_proxy())
            if res.status == 200:
                body = res.body if isinstance(res.body, bytes) else str(res.body).encode("utf-8")
                return body.decode("utf-8", "ignore")
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=error_response(code="UPSTREAM_ERROR", message=f"Status {res.status}", module="repository")
            )
        except Exception as e:
            if isinstance(e, HTTPException):
                raise e
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=error_response(code="UPSTREAM_ERROR", message=str(e), module="repository")
            )

    def fetch_search(self, q: str) -> str:
        """Pencarian portal baru (Laravel AJAX): butuh cookie sesi + searchToken.

        1. GET /repo/cari?q=...   -> cookie sesi + `var searchToken = "..."`
        2. GET /repo/search-q/... -> JSON {result, html} memakai header X-Search-Token
        """
        import httpx

        proxy = get_proxy()
        headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
            ),
            "Accept-Language": "id-ID,id;q=0.9",
        }

        safe_q = urllib.parse.quote_plus(q)
        page_url = f"{self.BASE_URL}/repo/cari?q={safe_q}"

        try:
            with httpx.Client(headers=headers, proxy=proxy, timeout=30, follow_redirects=True) as client:
                r1 = client.get(page_url)
                if r1.status_code != 200:
                    raise HTTPException(
                        status_code=status.HTTP_502_BAD_GATEWAY,
                        detail=error_response(
                            code="UPSTREAM_ERROR",
                            message=f"Repository search page status {r1.status_code}",
                            module="repository",
                        ),
                    )

                m_token = re.search(r'var\s+searchToken\s*=\s*"([^"]+)"', r1.text)
                search_token = m_token.group(1) if m_token else ""

                ajax_url = (
                    f"{self.BASE_URL}/repo/search-q/{urllib.parse.quote(q)}"
                    f"?type=all&page=1"
                )
                r2 = client.get(
                    ajax_url,
                    headers={
                        "X-Requested-With": "XMLHttpRequest",
                        "X-Search-Token": search_token,
                        "Referer": page_url,
                    },
                )
                if r2.status_code != 200:
                    raise HTTPException(
                        status_code=status.HTTP_502_BAD_GATEWAY,
                        detail=error_response(
                            code="UPSTREAM_ERROR",
                            message=f"Repository search ajax status {r2.status_code}",
                            module="repository",
                        ),
                    )

                try:
                    payload = r2.json()
                except ValueError:
                    payload = None

                html = ""
                if isinstance(payload, dict):
                    html = payload.get("html") or ""
                if not isinstance(html, str):
                    html = ""

                # Hasil kosong tetap valid (0 dokumen)
                return html

        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=error_response(code="UPSTREAM_ERROR", message=str(e), module="repository"),
            )

repository_client = RepositoryClient()

@router.get("/recent")
async def get_recent_repository():
    loop = asyncio.get_running_loop()
    return await cached_endpoint(
        module="repository",
        name="recent",
        fetch=lambda: loop.run_in_executor(None, repository_client.fetch_recent),
        parse=parse_repository_items,
        ttl=settings.TTL_LIBRARY,
    )

@router.get("/search")
async def search_repository(q: str = Query(..., min_length=1, description="Kata kunci pencarian")):
    loop = asyncio.get_running_loop()
    return await cached_endpoint(
        module="repository",
        name="search",
        fetch=lambda: loop.run_in_executor(None, repository_client.fetch_search, q),
        parse=parse_repository_items,
        ttl=settings.TTL_LIBRARY,
        cache_params={"q": q},
    )
