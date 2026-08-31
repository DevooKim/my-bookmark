import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type {
  JSONRPCMessage,
  MessageExtraInfo,
  RequestId,
} from "@modelcontextprotocol/sdk/types.js";
import { API_ERROR_CODES } from "@my-bookmark/shared";
import type { RequestHandler } from "express";
import { Router } from "express";
import { buildMcpServer } from "../mcp/server";
import {
  type ApiKeyVerifier,
  defaultApiKeyVerifier,
  getUserId,
} from "../middleware/auth";
import { HttpError } from "../middleware/error";

type TransportMessageHandler = (
  message: JSONRPCMessage,
  extra?: MessageExtraInfo,
) => void;

class McpTransportAdapter {
  constructor(private readonly transport: StreamableHTTPServerTransport) {}

  start(): Promise<void> {
    return this.transport.start();
  }

  send(
    message: JSONRPCMessage,
    options?: { relatedRequestId?: RequestId },
  ): Promise<void> {
    return this.transport.send(message, options);
  }

  close(): Promise<void> {
    return this.transport.close();
  }

  get onclose(): () => void {
    return this.transport.onclose ?? (() => {});
  }

  set onclose(handler: () => void) {
    this.transport.onclose = handler;
  }

  get onerror(): (error: Error) => void {
    return this.transport.onerror ?? (() => {});
  }

  set onerror(handler: (error: Error) => void) {
    this.transport.onerror = handler;
  }

  get onmessage(): TransportMessageHandler {
    return this.transport.onmessage ?? (() => {});
  }

  set onmessage(handler: TransportMessageHandler) {
    this.transport.onmessage = handler;
  }
}

export interface McpRouterDeps {
  apiKeyVerifier?: ApiKeyVerifier;
  buildServer?: (userId: string) => ReturnType<typeof buildMcpServer>;
}

function createApiKeyAuth(verifyApiKey: ApiKeyVerifier): RequestHandler {
  return async (request, _response, next) => {
    const headerApiKey = request.header("X-API-Key");
    const authorization = request.header("Authorization");
    const bearerApiKey = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    const apiKey =
      headerApiKey ??
      (bearerApiKey && /^bm_.+$/.test(bearerApiKey) ? bearerApiKey : undefined);

    if (!apiKey) {
      next(new HttpError(401, API_ERROR_CODES.UNAUTHORIZED, "Missing API key"));
      return;
    }

    try {
      request.userId = await verifyApiKey(apiKey);
      next();
    } catch (error) {
      next(error);
    }
  };
}

const methodNotAllowed: RequestHandler = (_request, response) => {
  response
    .status(405)
    .set("Allow", "POST")
    .json({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Method not allowed",
      },
      id: null,
    });
};

export function createMcpRouter({
  apiKeyVerifier = defaultApiKeyVerifier,
  buildServer = buildMcpServer,
}: McpRouterDeps = {}) {
  const router = Router();
  const authenticate = createApiKeyAuth(apiKeyVerifier);

  router.get("/mcp", methodNotAllowed);
  router.delete("/mcp", methodNotAllowed);
  router.use("/mcp", authenticate);
  router.post("/mcp", async (request, response) => {
    const server = buildServer(getUserId(request));
    // An omitted generator is undefined at runtime, which enables stateless mode.
    const transport = new StreamableHTTPServerTransport({
      enableJsonResponse: true,
    });
    const close = () => {
      void Promise.allSettled([transport.close(), server.close()]);
    };

    response.on("close", close);

    try {
      await server.connect(new McpTransportAdapter(transport));
      await transport.handleRequest(request, response, request.body);
    } catch (error) {
      console.warn("MCP transport request failed", error);
      if (!response.headersSent) {
        response.status(500).json({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: "Internal server error",
          },
          id: null,
        });
      }
    }
  });

  return router;
}

export const mcpRouter = createMcpRouter();
