# Database

This project uses **Drizzle ORM** with **Cloudflare D1** (SQLite) as the database layer. D1 is a serverless SQL database built on SQLite, available as a Cloudflare Workers binding.

## Documentation

- [Configuration](./configuration.md) -- architecture overview, config files, and the `createDb` factory
- [Schema](./schema.md) -- table definitions and relationships
- [How to Add a New Table](./adding-tables.md) -- step-by-step guide for adding tables
- [Migration Workflow](./migrations.md) -- migration commands and typical development cycle
- [Using the Database](./usage.md) -- route handler integration and environment types
- [Drizzle Query Examples](./query-examples.md) -- common query patterns (select, insert, update, delete, joins, batch, returning)
- [Dependencies](./dependencies.md) -- key packages and versions
