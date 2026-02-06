import { z } from "zod";

const DEFAULT_ALLOWED_ORIGINS = ["https://chatgpt.com", "https://chat.openai.com"];

function normalizeOrigin(input) {
  try {
    return new URL(String(input)).origin;
  } catch {
    return null;
  }
}

function parseAllowedOrigins(raw) {
  const set = new Set(DEFAULT_ALLOWED_ORIGINS);
  const parts = String(raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const p of parts) {
    const o = normalizeOrigin(p);
    if (o) set.add(o);
  }
  return set;
}

const EnvSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  MCP_PATH: z.string().trim().default("/mcp"),
  UPSTREAM_URL: z.string().trim().min(1),
  ALLOWED_ORIGINS: z.string().optional(),
  MAX_BODY_BYTES: z.coerce.number().int().min(1_000).max(50_000_000).default(200_000),
  AUTH_BEARER_TOKEN: z.string().optional(),
  UPSTREAM_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(5 * 60_000).default(30_000),
});

export function readConfig(env = process.env) {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".") || "env"}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment: ${msg}`);
  }

  const { PORT, MCP_PATH, UPSTREAM_URL, ALLOWED_ORIGINS, MAX_BODY_BYTES, AUTH_BEARER_TOKEN, UPSTREAM_TIMEOUT_MS } =
    parsed.data;

  let upstreamUrl;
  try {
    upstreamUrl = new URL(UPSTREAM_URL);
  } catch {
    throw new Error("UPSTREAM_URL must be a valid URL, e.g. http://127.0.0.1:8788/mcp");
  }

  return {
    port: PORT,
    mcpPath: MCP_PATH.startsWith("/") ? MCP_PATH : `/${MCP_PATH}`,
    upstreamUrl,
    allowedOrigins: parseAllowedOrigins(ALLOWED_ORIGINS),
    maxBodyBytes: MAX_BODY_BYTES,
    authBearerToken: String(AUTH_BEARER_TOKEN ?? "").trim() || null,
    upstreamTimeoutMs: UPSTREAM_TIMEOUT_MS,
  };
}

