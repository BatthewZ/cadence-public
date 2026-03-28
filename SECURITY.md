# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Cadence, please report it through [GitHub's private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability). This ensures the issue is handled privately until a fix is available.

**Please do not open public issues for security vulnerabilities.**

### What to include

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

### Response timeline

- **Acknowledgment:** Within 48 hours
- **Assessment:** Within 1 week
- **Fix release:** As soon as a patch is validated

## Scope

### In scope

- Authentication and session management (Better Auth)
- API authorization and access control (RBAC)
- Input validation and injection vulnerabilities
- File upload handling and storage
- Cross-site scripting (XSS) and cross-site request forgery (CSRF)
- Security header configuration (CSP, CORS)

### Out of scope

- Denial of service attacks
- Social engineering
- Vulnerabilities in third-party dependencies (report upstream)
- Issues in Cloudflare's infrastructure

## Security Features

Cadence implements the following protections:

- **Content Security Policy** with strict directives
- **Security headers** (X-Content-Type-Options, X-Frame-Options, HSTS, Referrer-Policy, Permissions-Policy)
- **Rate limiting** on authentication and upload endpoints
- **Input validation** via Zod schemas on all API endpoints
- **Parameterized queries** via Drizzle ORM (SQL injection protection)
- **File upload validation** with magic byte detection, MIME type whitelisting, and size limits
- **Role-based access control** at workspace, project, and task levels
- **CORS whitelisting** with explicit origin validation

## Known Limitations

- **Rate limiting is per-isolate (in-memory).** In a distributed Cloudflare Workers deployment, rate limits are not shared across isolates. For stricter enforcement, consider backing the rate limiter with KV or Durable Objects.
- **SPA CSP uses `unsafe-inline` for scripts.** A small inline script prevents flash of unstyled content (FOUC) during theme initialization. This is a documented trade-off.
