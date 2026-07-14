# Security Policy

## Supported Versions
| Version | Supported |
|---|---|
| latest (`main`) | ✅ |

## Reporting a Vulnerability
Please **do not** open a public issue for security vulnerabilities. Instead,
report them privately:

- Email **edy.cu@live.com**, or
- Use GitHub's [private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability) (Security → Report a vulnerability).

You'll get an acknowledgment within 48 hours and a resolution timeline after
triage. Please give us a reasonable window to patch before public disclosure.

## Scope Notes
The Commons is a Reddit Devvit Web app: zero runtime AI, an empty `http` fetch
allowlist in `devvit.json`, and no environment-variable secrets (auth is via
`devvit login`, not API keys). The most sensitive surface is the settle
transaction (`src/server/core/settle.ts`, Redis `watch/multi/exec`) and the
sealed-commit protocol (`src/server/core/commits.ts`) — reports touching
secrecy/idempotency there are especially welcome.
