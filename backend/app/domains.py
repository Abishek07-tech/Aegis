from dataclasses import dataclass
from hashlib import sha256
from urllib.parse import urlsplit

from dnstwist import Fuzzer


@dataclass(frozen=True)
class DomainCandidate:
    domain: str
    permutation: str
    fingerprint: str


def generate_domain_candidates(official_url: str, max_candidates: int = 100) -> list[DomainCandidate]:
    hostname = (urlsplit(official_url).hostname or "").rstrip(".").lower()
    if not hostname or "." not in hostname:
        return []
    fuzzer = Fuzzer(hostname)
    fuzzer.generate()
    candidates: list[DomainCandidate] = []
    for permutation in fuzzer.domains:
        domain = permutation.domain.lower().rstrip(".")
        if domain == hostname:
            continue
        candidates.append(DomainCandidate(
            domain=domain,
            permutation=permutation.fuzzer,
            fingerprint=sha256(f"dnstwist:{domain}".encode()).hexdigest(),
        ))
        if len(candidates) >= max(1, min(max_candidates, 500)):
            break
    return candidates
