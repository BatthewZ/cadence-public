# Webhook Versioning Strategy

## Overview

Webhook payloads are a contract with external consumers. Unlike the REST API (where the frontend deploys alongside the backend in lockstep), webhook consumers are decoupled — they build integrations against payload shapes and need clear guarantees about when and how those shapes change.

This document outlines a semantic versioning strategy for Cadence's webhook system, combined with auto-generated JSON Schema from existing Zod definitions.

## Semantic Versioning for Webhooks

The project version (semver) communicates compatibility guarantees to webhook consumers:

### Major (v1 → v2) — Breaking changes

Existing integrations will break if they don't update.

- Removed or renamed fields in a webhook payload
- Changed field types (e.g., `string` to `number`)
- Removed event types
- Changed payload structure (e.g., flattening nested objects)
- Changed authentication/signing mechanism
- Changed error or delivery semantics

### Minor (v1.1 → v1.2) — Additive, backwards-compatible changes

Existing integrations continue working untouched.

- New webhook event types added
- New optional fields added to existing payloads
- New metadata fields in delivery headers

### Patch (v1.1.1 → v1.1.2) — Bug fixes, no API surface change

- Fixing a field that was documented as one type but returned another
- Correcting payload generation bugs
- Delivery reliability fixes

## What counts as "breaking"

Some changes seem safe but aren't:

| Change | Breaking? | Why |
|--------|-----------|-----|
| Adding a required field to a payload | No (outbound) | Webhooks are outbound — consumers receive, not send |
| Removing a field from a payload | **Yes** | Consumers may depend on it |
| Adding an optional field to a payload | No | But consumers with strict parsing (`additionalProperties: false`) may reject it |
| Changing a field from `string` to `string \| null` | **Yes** | Consumers who don't handle null will break |
| Changing field name (rename) | **Yes** | Old name disappears |
| Removing a deprecated field | **Yes** | Even with prior warning |
| Changing HMAC signing algorithm | **Yes** | Verification will fail |

## Schema Publishing

### Approach

Use `zod-to-json-schema` to auto-generate JSON Schema from the existing Zod webhook payload definitions. This keeps the Zod schemas as the single source of truth — no manual documentation to drift.

### Delivery

- Serve the schema at `/api/webhooks/schema` so consumers can fetch it programmatically
- Schema output should include all 23 event types and their payload shapes
- Consumers can diff schemas between versions to understand what changed

### Example response shape

```json
{
  "version": "0.6.4",
  "events": {
    "task.created": { /* JSON Schema for task.created payload */ },
    "task.updated": { /* JSON Schema for task.updated payload */ },
    ...
  }
}
```

## Versioning scope

Webhook schema versioning follows the overall project version rather than being versioned independently. Rationale:

- Simpler to manage — one version number across the project
- Webhook schema changes are already reflected in the project changelog
- If webhook consumers develop significantly different lifecycle needs in the future, independent versioning can be introduced at that point

## Future considerations

- **Date-based versioning (Stripe model):** If the consumer base grows, consider date-based versions (e.g., `2026-03-27`) where each webhook subscription pins to the version at registration time. This allows running multiple payload versions simultaneously during migration windows.
- **Changelog automation:** Generate a webhook-specific changelog from schema diffs between tagged versions.
- **Deprecation policy:** Define a timeline (e.g., 90 days) for deprecated fields before removal in a major version.
