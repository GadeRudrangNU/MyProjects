import sys
import time
import urllib.request

URLS = ["http://127.0.0.1:8080/readyz", "http://127.0.0.1:8090/healthz"]
deadline = time.time() + 120
pending = list(URLS)
while pending and time.time() < deadline:
    for url in list(pending):
        try:
            urllib.request.urlopen(url, timeout=2).close()
            pending.remove(url)
        except OSError:
            pass
    time.sleep(1)
sys.exit(1 if pending else 0)
