import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Type } from "typebox";

type SupabaseMcpClient = {
  client: Client;
  transport: StdioClientTransport;
};

let cached: SupabaseMcpClient | undefined;
let cachedProjectRef: string | undefined;

function getProjectRef(): string | undefined {
  return process.env.SUPABASE_PROJECT_REF ?? "sieffvagayeluitgysgm";
}

function readLocalAccessToken(cwd: string): string | undefined {
  const envPath = join(cwd, ".pi", "supabase-mcp.env");
  if (!existsSync(envPath)) {
    return undefined;
  }

  const contents = readFileSync(envPath, "utf8");
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^\s*SUPABASE_ACCESS_TOKEN\s*=\s*(.+?)\s*$/);
    if (match?.[1]) {
      return match[1].replace(/^['\"]|['\"]$/g, "");
    }
  }
  return undefined;
}

async function getClient(cwd = process.cwd()): Promise<SupabaseMcpClient> {
  const projectRef = getProjectRef();
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN ?? readLocalAccessToken(cwd);
  if (!accessToken) {
    throw new Error(
      "SUPABASE_ACCESS_TOKEN is not set. Export it before starting pi or put it in .pi/supabase-mcp.env.",
    );
  }

  if (cached && cachedProjectRef === projectRef) {
    return cached;
  }

  if (cached) {
    await cached.client.close();
    cached = undefined;
  }

  const args = ["@supabase/mcp-server-supabase@0.8.2", "--read-only"];
  if (projectRef) {
    args.push(`--project-ref=${projectRef}`);
  }

  const transport = new StdioClientTransport({
    command: "npx",
    args,
    env: {
      ...process.env,
      SUPABASE_ACCESS_TOKEN: accessToken,
    },
  });
  const client = new Client({
    name: "pi-supabase-mcp",
    version: "0.1.0",
  });

  await client.connect(transport);
  cached = { client, transport };
  cachedProjectRef = projectRef;
  return cached;
}

export default function supabaseMcpExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "supabase_mcp_list_tools",
    label: "Supabase MCP: List Tools",
    description:
      "List tools exposed by the Supabase MCP server for this project. Requires SUPABASE_ACCESS_TOKEN in the pi process environment.",
    promptSnippet:
      "List available Supabase MCP tools for inspecting the configured Supabase project.",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const { client } = await getClient(ctx.cwd);
      const result = await client.listTools();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result.tools, null, 2),
          },
        ],
        details: result,
      };
    },
  });

  pi.registerTool({
    name: "supabase_mcp_call_tool",
    label: "Supabase MCP: Call Tool",
    description:
      "Call a Supabase MCP tool by name with JSON arguments. Use supabase_mcp_list_tools first to discover tool names and schemas. The MCP server is started in read-only mode.",
    promptSnippet:
      "Call a read-only Supabase MCP tool by name with JSON arguments.",
    parameters: Type.Object({
      name: Type.String({ description: "Supabase MCP tool name" }),
      arguments: Type.Optional(
        Type.Record(Type.String(), Type.Any(), {
          description: "Arguments matching the selected MCP tool schema",
        }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const { client } = await getClient(ctx.cwd);
      const result = await client.callTool({
        name: params.name,
        arguments: params.arguments ?? {},
      });
      return {
        content: result.content as Array<{ type: "text"; text: string }>,
        details: result,
      };
    },
  });

  pi.registerCommand("supabase-mcp-status", {
    description: "Check Supabase MCP configuration and tool availability",
    handler: async (_args, ctx) => {
      try {
        const { client } = await getClient(ctx.cwd);
        const result = await client.listTools();
        ctx.ui.notify(
          `Supabase MCP connected (${result.tools.length} tools, project ${getProjectRef() ?? "all"})`,
          "info",
        );
      } catch (error) {
        ctx.ui.notify(
          `Supabase MCP not ready: ${error instanceof Error ? error.message : String(error)}`,
          "error",
        );
      }
    },
  });

  pi.on("session_shutdown", async () => {
    if (cached) {
      await cached.client.close();
      cached = undefined;
    }
  });
}
