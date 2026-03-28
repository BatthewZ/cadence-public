# Redeploying

After making code changes:

```bash
bun run build              # Rebuild frontend
bun run db:migrate:remote  # Apply any new migrations (if schema changed)
bun run deploy             # Deploy
```

If only backend code changed (no schema changes), you can skip the migration step. If only frontend code changed, the build step is still required since the Worker serves the built assets.
