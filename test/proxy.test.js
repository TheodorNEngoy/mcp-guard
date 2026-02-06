import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";

import { createProxyHandler } from "../src/proxy.js";
import { corsHeadersForOrigin } from "../src/cors.js";

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve(`http://127.0.0.1:${addr.port}`);
    });
  });
}

test("preflight denies disallowed origin", async () => {
  const upstream = createServer((req, res) => res.writeHead(200).end("ok"));
  const upstreamBase = await listen(upstream);

  const proxy = createServer(
    createProxyHandler(
      {
        port: 0,
        mcpPath: "/mcp",
        upstreamUrl: new URL(`${upstreamBase}/mcp`),
        allowedOrigins: new Set(["https://chatgpt.com"]),
        maxBodyBytes: 200_000,
        upstreamTimeoutMs: 30_000,
        authBearerToken: null,
      },
      { corsHeadersForOrigin }
    )
  );
  const proxyBase = await listen(proxy);

  try {
    const res = await fetch(`${proxyBase}/mcp`, { method: "OPTIONS", headers: { Origin: "https://evil.example" } });
    assert.equal(res.status, 403);
  } finally {
    proxy.close();
    upstream.close();
  }
});

test("preflight allows allowlisted origin", async () => {
  const upstream = createServer((req, res) => res.writeHead(200).end("ok"));
  const upstreamBase = await listen(upstream);

  const proxy = createServer(
    createProxyHandler(
      {
        port: 0,
        mcpPath: "/mcp",
        upstreamUrl: new URL(`${upstreamBase}/mcp`),
        allowedOrigins: new Set(["https://chatgpt.com"]),
        maxBodyBytes: 200_000,
        upstreamTimeoutMs: 30_000,
        authBearerToken: null,
      },
      { corsHeadersForOrigin }
    )
  );
  const proxyBase = await listen(proxy);

  try {
    const res = await fetch(`${proxyBase}/mcp`, { method: "OPTIONS", headers: { Origin: "https://chatgpt.com" } });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get("access-control-allow-origin"), "https://chatgpt.com");
  } finally {
    proxy.close();
    upstream.close();
  }
});

test("proxies MCP request to upstream and preserves CORS", async () => {
  let hits = 0;
  const upstream = createServer((req, res) => {
    hits += 1;
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, body }));
    });
  });
  const upstreamBase = await listen(upstream);

  const proxy = createServer(
    createProxyHandler(
      {
        port: 0,
        mcpPath: "/mcp",
        upstreamUrl: new URL(`${upstreamBase}/mcp`),
        allowedOrigins: new Set(["https://chatgpt.com"]),
        maxBodyBytes: 200_000,
        upstreamTimeoutMs: 30_000,
        authBearerToken: null,
      },
      { corsHeadersForOrigin }
    )
  );
  const proxyBase = await listen(proxy);

  try {
    const res = await fetch(`${proxyBase}/mcp`, {
      method: "POST",
      headers: { Origin: "https://chatgpt.com", "Content-Type": "application/json" },
      body: JSON.stringify({ hello: "world" }),
    });

    assert.equal(res.status, 200);
    assert.equal(res.headers.get("access-control-allow-origin"), "https://chatgpt.com");
    const json = await res.json();
    assert.equal(json.ok, true);
    assert.equal(hits, 1);
  } finally {
    proxy.close();
    upstream.close();
  }
});

test("rejects too-large bodies", async () => {
  let hits = 0;
  const upstream = createServer((req, res) => {
    hits += 1;
    res.writeHead(200).end("ok");
  });
  const upstreamBase = await listen(upstream);

  const proxy = createServer(
    createProxyHandler(
      {
        port: 0,
        mcpPath: "/mcp",
        upstreamUrl: new URL(`${upstreamBase}/mcp`),
        allowedOrigins: new Set(["https://chatgpt.com"]),
        maxBodyBytes: 10,
        upstreamTimeoutMs: 30_000,
        authBearerToken: null,
      },
      { corsHeadersForOrigin }
    )
  );
  const proxyBase = await listen(proxy);

  try {
    const res = await fetch(`${proxyBase}/mcp`, {
      method: "POST",
      headers: { Origin: "https://chatgpt.com", "Content-Type": "application/json" },
      body: "01234567890",
    });
    assert.equal(res.status, 413);
    assert.equal(hits, 0);
  } finally {
    proxy.close();
    upstream.close();
  }
});

test("optional bearer token gate", async () => {
  let hits = 0;
  const upstream = createServer((req, res) => {
    hits += 1;
    res.writeHead(200).end("ok");
  });
  const upstreamBase = await listen(upstream);

  const proxy = createServer(
    createProxyHandler(
      {
        port: 0,
        mcpPath: "/mcp",
        upstreamUrl: new URL(`${upstreamBase}/mcp`),
        allowedOrigins: new Set(["https://chatgpt.com"]),
        maxBodyBytes: 200_000,
        upstreamTimeoutMs: 30_000,
        authBearerToken: "secret",
      },
      { corsHeadersForOrigin }
    )
  );
  const proxyBase = await listen(proxy);

  try {
    const res = await fetch(`${proxyBase}/mcp`, {
      method: "POST",
      headers: { Origin: "https://chatgpt.com", "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(res.status, 401);
    assert.equal(hits, 0);

    const res2 = await fetch(`${proxyBase}/mcp`, {
      method: "POST",
      headers: {
        Origin: "https://chatgpt.com",
        Authorization: "Bearer secret",
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    assert.equal(res2.status, 200);
    assert.equal(hits, 1);
  } finally {
    proxy.close();
    upstream.close();
  }
});

