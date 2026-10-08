# Security

Argon2id hashes passwords and short-lived signed JWTs identify users. All
investigation reads use both the investigation ID and authenticated user ID.
External URL collection is not enabled in this phase. Before enabling it,
implement centralized URL normalization, DNS-before-connect SSRF checks,
redirect revalidation, response-size limits, and connect/read timeouts.
