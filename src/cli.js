#!/usr/bin/env node

import { createServer } from "node:http";

import { readConfig } from "./config.js";
import { corsHeadersForOrigin } from "./cors.js";
import { createProxyHandler } from "./proxy.js";

const config = readConfig(process.env);

const handler = createProxyHandler(config, { corsHeadersForOrigin });
const server = createServer(handler);

server.listen(config.port, () => {
  console.log(`mcp-guard listening on :${config.port}${config.mcpPath}`);
  console.log(`upstream: ${config.upstreamUrl.toString()}`);
  console.log(`allowed origins: ${[...config.allowedOrigins].join(", ")}`);
});

