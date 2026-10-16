import re

EMAIL = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")
IPV4 = re.compile(r"\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b")
PHONE = re.compile(r"(^|[^\w.])((?:\+?\d{1,3}[\s.\-]?)?(?:\(\d{3}\)|\d{3})[\s.\-]?\d{3}[\s.\-]?\d{4})(?!\w)")


def scrub(text: str) -> str:
    if not text:
        return ""
    text = EMAIL.sub("[EMAIL]", text)
    text = IPV4.sub("[IP]", text)
    return PHONE.sub(r"\1[PHONE]", text)


def contains_pii(text: str) -> bool:
    return scrub(text) != text
