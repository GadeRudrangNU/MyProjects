import httpx


class InfraError(Exception):
    """The platform failed, not the device: reported as ERROR, never as FAIL."""


class GatewayClient:
    def __init__(self, base_url: str):
        self.http = httpx.AsyncClient(base_url=base_url, timeout=20)

    async def close(self):
        await self.http.aclose()

    async def _call(self, method: str, url: str, **kw):
        try:
            resp = await self.http.request(method, url, **kw)
        except httpx.HTTPError as e:
            raise InfraError(f"gateway unreachable: {type(e).__name__}") from e
        if resp.status_code >= 500:
            raise InfraError(f"gateway error {resp.status_code}: {resp.text[:120]}")
        if resp.status_code >= 400:
            raise InfraError(f"gateway rejected request: {resp.text[:120]}")
        return resp.json()

    async def device(self, device_id: int) -> dict:
        return (await self._call("GET", f"/api/devices/{device_id}"))["device"]

    async def command(self, device_id: int, cmd: str, args: dict, timeout_ms: int) -> dict:
        return await self._call(
            "POST", f"/api/devices/{device_id}/commands", json={"cmd": cmd, "args": args, "timeout_ms": timeout_ms}
        )

    async def telemetry(self, device_id: int, start_ms: int, end_ms: int, signal: str | None = None) -> list[dict]:
        params = {"from": start_ms, "to": end_ms}
        if signal:
            params["signal"] = signal
        return await self._call("GET", f"/api/devices/{device_id}/telemetry", params=params)
