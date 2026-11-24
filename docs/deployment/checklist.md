# Deployment Checklist

1. [ ] D1 database created (`wrangler d1 create cadence_au`)
2. [ ] `database_id` in `wrangler.toml` set to the real UUID
3. [ ] `BETTER_AUTH_SECRET` secret set (`wrangler secret put BETTER_AUTH_SECRET`)
4. [ ] `BETTER_AUTH_URL` secret set (`wrangler secret put BETTER_AUTH_URL`)
5. [ ] `TOKEN_HASH_PEPPER` secret set (`wrangler secret put TOKEN_HASH_PEPPER`) — without it, creating or using API tokens and calendar feeds returns 500
6. [ ] Frontend built (`bun run build`)
7. [ ] Migrations applied to production (`bun run db:migrate:remote`)
8. [ ] Deployed (`bun run deploy`)
9. [ ] (Optional) Custom domain configured and `BETTER_AUTH_URL` updated
