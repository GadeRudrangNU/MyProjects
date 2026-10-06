"""Fetch a public job posting from a URL"""
from __future__ import annotations

import ipaddress
import json
import re
import socket
from urllib.parse import urlparse
from urllib.robotparser import RobotFileParser

import requests
from bs4 import BeautifulSoup

UA = "CoopCompassBot/0.1 (personal job-search tool; single page fetch on user request)"
MAX_BYTES = 2_000_000


class ExtractionError(Exception):
    pass


def _check_url(url: str) -> str:
    p = urlparse(url)
    if p.scheme not in {"http", "https"} or not p.hostname:
        raise ExtractionError("Enter a full http(s) URL.")
    try:
        for info in socket.getaddrinfo(p.hostname, None):
            ip = ipaddress.ip_address(info[4][0])
            if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
                raise ExtractionError("That address is on a private network and cannot be fetched.")
    except socket.gaierror as exc:
        raise ExtractionError("Could not resolve that host.") from exc
    return url


def _robots_allows(url: str) -> bool:
    p = urlparse(url)
    try:
        r = requests.get(f"{p.scheme}://{p.netloc}/robots.txt", headers={"User-Agent": UA}, timeout=5)
        if r.status_code >= 400:
            return True
        rp = RobotFileParser()
        rp.parse(r.text.splitlines())
        return rp.can_fetch(UA, url)
    except requests.RequestException:
        return True


def _text(html: str) -> str:
    return BeautifulSoup(html or "", "html.parser").get_text("\n", strip=True)


def parse_html(html: str, url: str) -> dict:
    soup = BeautifulSoup(html, "html.parser")
    out = {"title": "", "company": "", "location": None, "description": "", "employment_type": None, "deadline": None}
    for tag in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(tag.string or "")
        except ValueError:
            continue
        items = data if isinstance(data, list) else data.get("@graph", [data]) if isinstance(data, dict) else []
        for it in items:
            if isinstance(it, dict) and it.get("@type") == "JobPosting":
                org = it.get("hiringOrganization") or {}
                loc = it.get("jobLocation")
                loc = loc[0] if isinstance(loc, list) and loc else loc
                addr = (loc or {}).get("address", {}) if isinstance(loc, dict) else {}
                out.update(
                    title=it.get("title", ""),
                    company=org.get("name", "") if isinstance(org, dict) else str(org),
                    location=", ".join(x for x in [addr.get("addressLocality"), addr.get("addressRegion")] if x) or None,
                    description=_text(it.get("description", "")),
                    employment_type=str(it.get("employmentType") or "") or None,
                    deadline=(it.get("validThrough") or "")[:10] or None,
                )
                if out["description"]:
                    return out
    for t in soup(["script", "style", "nav", "header", "footer", "noscript", "svg"]):
        t.decompose()
    main = soup.find("main") or soup.find("article") or soup.body or soup
    out["description"] = main.get_text("\n", strip=True)
    og = soup.find("meta", property="og:title")
    out["title"] = (og["content"] if og and og.get("content") else (soup.title.string if soup.title else "")) or ""
    site = soup.find("meta", property="og:site_name")
    out["company"] = (site["content"] if site and site.get("content") else urlparse(url).hostname or "")
    return out


def fetch_posting(url: str) -> dict:
    _check_url(url)
    if not _robots_allows(url):
        raise ExtractionError("This site's robots.txt disallows automated fetching. Please paste the job description instead.")
    try:
        r = requests.get(url, headers={"User-Agent": UA, "Accept": "text/html"}, timeout=10, stream=True)
        if r.status_code in (401, 403, 429):
            raise ExtractionError(f"The site blocked automated access (HTTP {r.status_code}). Please paste the job description instead.")
        r.raise_for_status()
        raw = r.raw.read(MAX_BYTES, decode_content=True)
        html = raw.decode(r.encoding or "utf-8", errors="ignore")
    except requests.RequestException as exc:
        raise ExtractionError(f"Could not fetch the page ({type(exc).__name__}). Please paste the job description instead.") from exc
    out = parse_html(html, url)
    out["description"] = re.sub(r"\n{3,}", "\n\n", out["description"]).strip()
    if len(out["description"]) < 300:
        raise ExtractionError("Could not find a job description on that page (it may need JavaScript or a login). "
                              "Please paste the job description instead.")
    return out
