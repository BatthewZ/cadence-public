# Deployment

This project deploys as a **Cloudflare Worker** that serves both the API (Hono) and the frontend (React SPA) from a single Worker. The frontend is built with Vite and served as static assets. The database runs on Cloudflare D1 (serverless SQLite).

## Documentation

- [Prerequisites](./prerequisites.md) -- required accounts, tools, and setup
- [Deployment Guide](./guide.md) -- step-by-step deployment instructions
- [Custom Domains](./custom-domains.md) -- using a custom domain with your Worker
- [Environment Variables](./environment.md) -- local and production environment configuration
- [Build & Deploy Scripts](./scripts.md) -- available scripts from package.json
- [Deployment Checklist](./checklist.md) -- pre-deployment checklist
- [Redeploying](./redeploying.md) -- how to redeploy after changes
