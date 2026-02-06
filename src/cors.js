export function corsHeadersForOrigin(origin, { allowedOrigins }) {
  if (!origin) return null;
  if (!allowedOrigins || !allowedOrigins.has(origin)) return null;

  return {
    "Access-Control-Allow-Origin": origin,
    Vary: "Origin",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS, DELETE",
    "Access-Control-Allow-Headers": "content-type, mcp-session-id, authorization",
    "Access-Control-Expose-Headers": "Mcp-Session-Id",
    "Access-Control-Max-Age": "600",
  };
}

