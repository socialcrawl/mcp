#!/usr/bin/env node
/**
 * AX benchmark helper: use the MCP server's tool surface from a shell.
 *
 * A benchmark agent that only has Bash can still act as an MCP client: this
 * starts the server in-process (from a built dist dir) over the SDK's in-memory
 * transport, so the tools, descriptions and schemas it sees are exactly what an
 * MCP client sees.
 *
 *   node scripts/ax-mcp-cli.mjs [--dist <dir>] list [--brief]
 *   node scripts/ax-mcp-cli.mjs [--dist <dir>] instructions
 *   node scripts/ax-mcp-cli.mjs [--dist <dir>] call <tool> '<json-args>'
 *
 * `--dist` defaults to ./dist. SOCIALCRAWL_API_KEY is read from the environment
 * when set (discovery tools need none) and is never printed: any occurrence in
 * the output is replaced with [redacted].
 */
import { register } from "node:module";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const USAGE = `usage:
  ax-mcp-cli.mjs [--dist <dir>] list [--brief]
  ax-mcp-cli.mjs [--dist <dir>] instructions
  ax-mcp-cli.mjs [--dist <dir>] call <tool> '<json-args>'`;

function fail(message, code = 2) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

function redact(text) {
  const key = process.env.SOCIALCRAWL_API_KEY;
  return key ? text.split(key).join("[redacted]") : text;
}

function out(text) {
  process.stdout.write(`${redact(text)}\n`);
}

// A dist dir that sits outside the repo (a baseline copy) has no node_modules
// of its own. Let its bare imports fall back to this package's install.
const hookSource = `
let fallback;
export function initialize(data) { fallback = data.fallback; }
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    const bare = !/^(\\.|\\/|file:|node:|data:)/.test(specifier);
    if (fallback && bare && error && error.code === "ERR_MODULE_NOT_FOUND") {
      return nextResolve(specifier, { ...context, parentURL: fallback });
    }
    throw error;
  }
}`;
register(`data:text/javascript,${encodeURIComponent(hookSource)}`, {
  parentURL: import.meta.url,
  data: { fallback: import.meta.url },
});

// ---- args -----------------------------------------------------------------
const argv = process.argv.slice(2);
let distDir = "./dist";
const rest = [];
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === "--dist") {
    distDir = argv[i + 1] ?? fail(USAGE);
    i += 1;
  } else {
    rest.push(argv[i]);
  }
}
const [command, ...cmdArgs] = rest;
if (!["list", "instructions", "call"].includes(command ?? "")) fail(USAGE);

const dist = resolve(distDir);
for (const f of ["server.js", "context.js"]) {
  if (!existsSync(resolve(dist, f))) fail(`${f} not found in ${dist} (build the MCP first: npm run build)`);
}

let toolArgs = {};
if (command === "call") {
  if (!cmdArgs[0]) fail(USAGE);
  if (cmdArgs[1] !== undefined) {
    try {
      toolArgs = JSON.parse(cmdArgs[1]);
    } catch {
      fail("call: the arguments must be one JSON object, e.g. '{\"platform\":\"tiktok\"}'");
    }
    if (toolArgs === null || typeof toolArgs !== "object" || Array.isArray(toolArgs)) {
      fail("call: the arguments must be one JSON object");
    }
  }
}

// ---- run ------------------------------------------------------------------
const { createServer } = await import(pathToFileURL(resolve(dist, "server.js")).href);
const { contextFromEnv } = await import(pathToFileURL(resolve(dist, "context.js")).href);

const server = createServer(contextFromEnv());
const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
await server.connect(serverSide);
const client = new Client({ name: "ax-mcp-cli", version: "0.0.0" });
await client.connect(clientSide);

let exitCode = 0;
try {
  if (command === "instructions") {
    out(client.getInstructions() ?? "");
  } else if (command === "list") {
    const { tools } = await client.listTools();
    if (cmdArgs.includes("--brief")) {
      for (const t of tools) out(`${t.name}\t${(t.description ?? "").split("\n")[0]}`);
    } else {
      out(JSON.stringify(tools, null, 2));
    }
  } else {
    const result = await client.callTool({ name: cmdArgs[0], arguments: toolArgs });
    const text = (result.content ?? [])
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n");
    out(text);
    if (result.isError) exitCode = 1;
  }
} catch (error) {
  process.stderr.write(`${redact(error instanceof Error ? error.message : String(error))}\n`);
  exitCode = 1;
} finally {
  await client.close();
}
process.exit(exitCode);
