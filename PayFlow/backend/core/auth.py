from dataclasses import dataclass

from rest_framework import authentication, exceptions

from .models import ApiClient, hash_api_key


@dataclass
class ClientPrincipal:
    client: ApiClient
    is_authenticated: bool = True


class ApiKeyAuthentication(authentication.BaseAuthentication):
    """`Authorization: Bearer pf_...` or `X-API-Key: pf_...`."""

    def authenticate_header(self, request) -> str:
        return "Bearer"

    def authenticate(self, request):
        raw = request.headers.get("X-API-Key", "")
        header = request.headers.get("Authorization", "")
        if not raw and header.lower().startswith("bearer "):
            raw = header[7:].strip()
        if not raw:
            return None
        try:
            client = ApiClient.objects.get(key_hash=hash_api_key(raw), is_active=True)
        except ApiClient.DoesNotExist:
            raise exceptions.AuthenticationFailed("Invalid API key.") from None
        return ClientPrincipal(client), raw


def client_of(request) -> ApiClient:
    return request.user.client
