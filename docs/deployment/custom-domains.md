# Custom Domains

To use a custom domain instead of the default `workers.dev` subdomain:

1. Go to the [Cloudflare dashboard](https://dash.cloudflare.com/)
2. Navigate to **Workers & Pages** > your Worker
3. Go to the **Triggers** tab (or **Custom Domains** section)
4. Add your custom domain

The domain must be managed by Cloudflare (proxied through Cloudflare DNS). After adding the custom domain, update the `BETTER_AUTH_URL` secret to match:

```bash
wrangler secret put BETTER_AUTH_URL
# Enter: https://your-custom-domain.com
```
