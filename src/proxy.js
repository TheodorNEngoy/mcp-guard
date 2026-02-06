import http from "node:http";
import https from "node:https";
import { Transform } from "node:stream";

function normalizePath(p) {
  const s = typeof p === "string" ? p : "/";
  const noQuery = s.split("?")[0].split("#")[0];
  const withoutTrailing = noQuery !== "/" ? noQuery.replace(/\/+$/, "") : noQuery;
  return withoutTrailing || "/";
}

function isHopByHopHeader(name) {
  const n = String(name ?? "").toLowerCase();
  return (
    n === "connection" ||
    n === "keep-alive" ||
    n === "proxy-authenticate" ||
    n === "proxy-authorization" ||
    n === "te" ||
    n === "trailer" ||
    n === "transfer-encoding" ||
    n === "upgrade"
  );
}

function sanitizeRequestHeaders(inHeaders) {
  const out = {};
  for (const [k, v] of Object.entries(inHeaders ?? {})) {
    const key = String(k);
    if (!key) continue;
    const lower = key.toLowerCase();
    if (lower === "host") continue;
    if (isHopByHopHeader(lower)) continue;
    out[key] = v;
  }
  return out;
}

export function createSizeLimitStream({ maxBytes }) {
  let seen = 0;
  return new Transform({
    transform(chunk, _enc, cb) {
      seen += chunk?.length ?? 0;
      if (seen > maxBytes) {
        const err = new Error("Body too large");
        err.code = "BODY_TOO_LARGE";
        cb(err);
        return;
      }
      cb(null, chunk);
    },
  });
}

export function createProxyHandler(config, { corsHeadersForOrigin }) {
  const { mcpPath, upstreamUrl, maxBodyBytes, upstreamTimeoutMs, authBearerToken, allowedOrigins } = config;

  const upstreamClient = upstreamUrl.protocol === "https:" ? https : http;

  return async function handler(req, res) {
    if (!req?.url || !req?.method) {
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff" });
      return res.end("Bad request");
    }

    const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
    const path = normalizePath(url.pathname);

    if (req.method === "GET" && path === "/health") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "X-Content-Type-Options": "nosniff" });
      return res.end(JSON.stringify({ ok: true }));
    }

    const origin = String(req.headers.origin ?? "");
    const cors = corsHeadersForOrigin(origin, { allowedOrigins });

    // Preflight for MCP
    if (req.method === "OPTIONS" && path === mcpPath) {
      if (!cors) {
        res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff" });
        return res.end("Origin not allowed");
      }
      res.writeHead(204, { ...cors, "X-Content-Type-Options": "nosniff" });
      return res.end();
    }

    const MCP_METHODS = new Set(["POST", "GET", "DELETE"]);
    if (path !== mcpPath || !MCP_METHODS.has(req.method)) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff" });
      return res.end("Not found");
    }

    if (origin && !cors) {
      res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff" });
      return res.end("Origin not allowed");
    }

    if (authBearerToken) {
      const auth = String(req.headers.authorization ?? "");
      const ok = auth === `Bearer ${authBearerToken}`;
      if (!ok) {
        res.writeHead(401, { "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff" });
        return res.end("Unauthorized");
      }
    }

    const contentLength = Number(req.headers["content-length"] ?? 0);
    if (Number.isFinite(contentLength) && contentLength > maxBodyBytes) {
      res.writeHead(413, { "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff" });
      return res.end("Request too large");
    }

    const target = new URL(upstreamUrl.toString());
    // Preserve any query string from the incoming request.
    target.search = url.search;

    const headers = sanitizeRequestHeaders(req.headers);
    headers["X-Forwarded-Proto"] = url.protocol.replace(":", "");
    headers["X-Forwarded-Host"] = String(req.headers.host ?? "");
    headers["X-Forwarded-For"] = String(req.socket?.remoteAddress ?? "");

    const upstreamReq = upstreamClient.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || undefined,
        method: req.method,
        path: target.pathname + target.search,
        headers,
        timeout: upstreamTimeoutMs,
      },
      (upstreamRes) => {
        const outHeaders = {};
        for (const [k, v] of Object.entries(upstreamRes.headers ?? {})) {
          if (!k) continue;
          if (isHopByHopHeader(k)) continue;
          outHeaders[k] = v;
        }

        if (cors) Object.assign(outHeaders, cors);
        outHeaders["X-Content-Type-Options"] = "nosniff";

        res.writeHead(upstreamRes.statusCode ?? 502, outHeaders);
        upstreamRes.pipe(res);
      }
    );

    upstreamReq.on("timeout", () => {
      upstreamReq.destroy(new Error("Upstream timeout"));
    });

    upstreamReq.on("error", (err) => {
      if (res.headersSent) {
        res.destroy(err);
        return;
      }
      const code = err?.code === "BODY_TOO_LARGE" ? 413 : 502;
      res.writeHead(code, { "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff" });
      res.end(code === 413 ? "Request too large" : "Bad gateway");
    });

    res.on("close", () => {
      upstreamReq.destroy();
    });

    const limiter = createSizeLimitStream({ maxBytes: maxBodyBytes });
    limiter.on("error", (err) => upstreamReq.destroy(err));

    req.pipe(limiter).pipe(upstreamReq);
  };
}

