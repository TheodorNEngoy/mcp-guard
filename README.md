# mcp-guard

`mcp-guard` is a small reverse proxy that sits in front of an existing MCP HTTP endpoint and enforces a few safe defaults:

- CORS allowlist (no wildcard `*`, no reflected origins)
- Request body size guard
- Optional bearer token gate

It is **language-agnostic**: your upstream can be any server that exposes an MCP endpoint over HTTP.

## Run

```bash
cd /Users/theodornengoy/Projects/mcp-guard
npm install
npm test

# Example: guard http://localhost:8788/mcp and expose it on http://localhost:8787/mcp
UPSTREAM_URL="http://localhost:8788/mcp" \
ALLOWED_ORIGINS="https://chatgpt.com,https://chat.openai.com" \
npm start
```

## Configure

Environment variables:

- `PORT` (default: `8787`)
- `MCP_PATH` (default: `/mcp`)
- `UPSTREAM_URL` (required): full URL to upstream MCP endpoint (e.g. `http://127.0.0.1:8788/mcp`)
- `ALLOWED_ORIGINS` (optional): comma-separated origins. Defaults include ChatGPT origins.
- `MAX_BODY_BYTES` (default: `200000`)
- `AUTH_BEARER_TOKEN` (optional): if set, require `Authorization: Bearer <token>` for all MCP requests
- `UPSTREAM_TIMEOUT_MS` (default: `30000`)

## Docker

```bash
docker build -t mcp-guard .
docker run --rm -p 8787:8787 \\
  -e UPSTREAM_URL="http://host.docker.internal:8788/mcp" \\
  -e ALLOWED_ORIGINS="https://chatgpt.com,https://chat.openai.com" \\
  mcp-guard
```

## Why This Matters

The most common high-severity bug in tool servers is permissive CORS. `mcp-guard` lets you reduce exposure without rewriting your upstream server.

