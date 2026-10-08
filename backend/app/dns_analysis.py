from dataclasses import dataclass
from typing import Protocol

import dns.exception
import dns.resolver

from .sources import SourceState


class Resolver(Protocol):
    def resolve(self, qname: str, rdtype: str, lifetime: float) -> object: ...


@dataclass(frozen=True)
class DnsResponse:
    domain: str
    state: SourceState
    records: dict[str, list[str]]
    no_record: bool = False
    error: str | None = None
    collector: str = "dnspython"
    collector_version: str = "2.7.0"


class DnsAnalyzer:
    record_types = ("A", "AAAA", "CNAME", "MX", "NS")

    def __init__(self, resolver: Resolver | None = None, lifetime: float = 4.0) -> None:
        self.resolver = resolver or dns.resolver.Resolver()
        self.lifetime = max(0.5, min(lifetime, 15.0))

    def analyze(self, domain: str) -> DnsResponse:
        normalized = domain.rstrip(".").lower()
        if not normalized or any(not label for label in normalized.split(".")):
            return DnsResponse(normalized, SourceState.FAILED, {}, error="Invalid domain")
        records: dict[str, list[str]] = {}
        failures: list[str] = []
        had_answer = False
        for record_type in self.record_types:
            try:
                answer = self.resolver.resolve(normalized, record_type, lifetime=self.lifetime)
                values = [self._value(record_type, item) for item in answer]
                values = [value for value in values if value]
                if values:
                    records[record_type] = values
                    had_answer = True
            except dns.resolver.NXDOMAIN:
                continue
            except dns.resolver.NoAnswer:
                continue
            except (dns.resolver.NoNameservers, dns.exception.Timeout, OSError) as exc:
                failures.append(f"{record_type}: {type(exc).__name__}")
        if had_answer:
            return DnsResponse(normalized, SourceState.REAL, records, error="; ".join(failures) or None)
        if failures:
            return DnsResponse(normalized, SourceState.UNAVAILABLE, {}, error="; ".join(failures))
        return DnsResponse(normalized, SourceState.REAL, {}, no_record=True)

    @staticmethod
    def _value(record_type: str, record: object) -> str:
        if record_type == "MX":
            return str(record).rstrip(".")
        return str(record).rstrip(".")
