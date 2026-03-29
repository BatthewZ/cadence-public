# Custom Domains

To use a custom domain instead of the default `workers.dev` subdomain:

## Option 1: Via Cloudflare Dashboard

1. Go to the [Cloudflare dashboard](https://dash.cloudflare.com/)
2. Navigate to **Workers & Pages** > your Worker
3. Go to the **Triggers** tab (or **Custom Domains** section)
4. Add your custom domain

## Option 2: Via `wrangler.toml`

Add a `[[routes]]` entry to `wrangler.toml`:

```toml
[[routes]]
pattern = "your-custom-domain.com"
custom_domain = true
```

This declares the custom domain in code so it is applied on every `wrangler deploy`.

## Post-Setup

The domain must be managed by Cloudflare (proxied through Cloudflare DNS). After adding the custom domain, update the `BETTER_AUTH_URL` secret to match:

```bash
wrangler secret put BETTER_AUTH_URL
# Enter: https://your-custom-domain.com
```

### `workers_dev`

The `workers_dev` flag in `wrangler.toml` controls whether the default `*.workers.dev` subdomain is enabled alongside any custom domains. Set to `true` (the default) to keep the workers.dev URL active, or `false` to disable it once your custom domain is live.
