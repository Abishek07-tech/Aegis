import ipaddress
import socket
from urllib.parse import urlsplit, urlunsplit


class UnsafeUrl(ValueError):
    """The URL is not safe for server-side retrieval."""


def _blocked_ip(value: str) -> bool:
    address = ipaddress.ip_address(value)
    return any(
        (
            address.is_private,
            address.is_loopback,
            address.is_link_local,
            address.is_multicast,
            address.is_reserved,
            address.is_unspecified,
        )
    ) or value == "169.254.169.254"


def normalize_public_url(value: str, resolve: bool = True) -> str:
    parsed = urlsplit(value.strip())
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise UnsafeUrl("Only HTTP and HTTPS URLs with a hostname are supported")
    if parsed.username or parsed.password:
        raise UnsafeUrl("URLs with embedded credentials are not supported")
    hostname = parsed.hostname.rstrip(".").lower()
    if hostname in {"localhost", "metadata.google.internal"} or hostname.endswith(".localhost"):
        raise UnsafeUrl("Internal hostnames are not allowed")
    try:
        literal = ipaddress.ip_address(hostname)
    except ValueError:
        literal = None
    if literal and _blocked_ip(str(literal)):
        raise UnsafeUrl("Private or reserved IP addresses are not allowed")
    if resolve:
        try:
            answers = socket.getaddrinfo(hostname, parsed.port or (443 if parsed.scheme == "https" else 80), type=socket.SOCK_STREAM)
        except socket.gaierror as exc:
            raise UnsafeUrl("Hostname could not be resolved") from exc
        if not answers or any(_blocked_ip(result[4][0]) for result in answers):
            raise UnsafeUrl("Hostname resolves to a private or reserved address")
    port = f":{parsed.port}" if parsed.port else ""
    return urlunsplit((parsed.scheme, f"{hostname}{port}", parsed.path or "/", parsed.query, ""))
