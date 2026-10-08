import dns.exception
import dns.resolver

from app.dns_analysis import DnsAnalyzer
from app.sources import SourceState


class Resolver:
    def __init__(self, records=None, error=None):
        self.records = records or {}
        self.error = error

    def resolve(self, domain, record_type, lifetime):
        if self.error:
            raise self.error
        values = self.records.get(record_type)
        if not values:
            raise dns.resolver.NoAnswer()
        return values


def test_dns_success_collects_bounded_record_types():
    result = DnsAnalyzer(Resolver({"A": ["203.0.113.10"], "MX": ["10 mail.example."]})).analyze("Example.COM.")
    assert result.state == SourceState.REAL
    assert result.records["A"] == ["203.0.113.10"]
    assert result.records["MX"] == ["10 mail.example"]


def test_dns_no_records_is_not_malicious():
    result = DnsAnalyzer(Resolver()).analyze("missing.example")
    assert result.state == SourceState.REAL
    assert result.no_record
    assert result.records == {}


def test_dns_timeout_is_unavailable():
    result = DnsAnalyzer(Resolver(error=dns.exception.Timeout())).analyze("slow.example")
    assert result.state == SourceState.UNAVAILABLE
    assert result.error


def test_dns_malformed_domain_fails_without_querying():
    result = DnsAnalyzer(Resolver()).analyze("bad..domain")
    assert result.state == SourceState.FAILED
