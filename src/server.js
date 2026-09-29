import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import {
  archiveRequest,
  createRequest,
  ensureStore,
  getRequest,
  listRequests,
  queueDir,
  updateRequest
} from "./store.js";

const STATUSES = ["new", "accepted", "processing", "blocked", "done", "rejected"];
const PRIORITIES = ["low", "normal", "high"];

export async function createServer() {
  await ensureStore();

  const server = new Server(
    {
      name: "jason-mcp",
      version: "0.1.0"
    },
    {
      capabilities: {
        tools: {},
        resources: {}
      }
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "submit_jason_request",
        description:
          "Submit a structured request to Jason/OpenClaw. This creates an inbox item; it does not execute shell, HA, GitHub, Drive, or website changes directly.",
        inputSchema: {
          type: "object",
          required: ["title", "body"],
          properties: {
            title: {
              type: "string",
              description: "Short request title.",
              minLength: 3
            },
            body: {
              type: "string",
              description: "Full request body, including relevant context.",
              minLength: 3
            },
            priority: {
              type: "string",
              enum: PRIORITIES,
              default: "normal"
            },
            desiredOutcome: {
              type: "string",
              description: "What done should look like."
            },
            sourceContext: {
              type: "string",
              description: "Where the request came from, e.g. Tesla/Grok/Cursor."
            },
            requiresReply: {
              type: "boolean",
              default: true
            }
          }
        }
      },
      {
        name: "list_jason_requests",
        description: "List recent Jason MCP inbox requests.",
        inputSchema: {
          type: "object",
          properties: {
            status: {
              type: "string",
              enum: STATUSES
            },
            limit: {
              type: "integer",
              minimum: 1,
              maximum: 100,
              default: 20
            }
          }
        }
      },
      {
        name: "read_jason_request",
        description: "Read one Jason MCP inbox request by id.",
        inputSchema: {
          type: "object",
          required: ["id"],
          properties: {
            id: {
              type: "string"
            }
          }
        }
      },
      {
        name: "update_jason_request",
        description:
          "Update a Jason MCP inbox request status or reply. Intended for Jason/OpenClaw or an explicitly trusted local operator.",
        inputSchema: {
          type: "object",
          required: ["id"],
          properties: {
            id: {
              type: "string"
            },
            status: {
              type: "string",
              enum: STATUSES
            },
            reply: {
              type: "string"
            },
            note: {
              type: "string"
            },
            actor: {
              type: "string",
              default: "jason"
            }
          }
        }
      },
      {
        name: "archive_jason_request",
        description: "Archive a completed or rejected Jason MCP inbox request.",
        inputSchema: {
          type: "object",
          required: ["id"],
          properties: {
            id: {
              type: "string"
            }
          }
        }
      }
    ]
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;
    if (name === "submit_jason_request") {
      const created = await createRequest(args);
      return toolJson(created);
    }
    if (name === "list_jason_requests") {
      return toolJson(await listRequests(args));
    }
    if (name === "read_jason_request") {
      return toolJson(await getRequest(args.id));
    }
    if (name === "update_jason_request") {
      return toolJson(await updateRequest(args));
    }
    if (name === "archive_jason_request") {
      return toolJson(await archiveRequest(args.id));
    }
    throw new Error(`Unknown tool: ${name}`);
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [
      {
        uri: "jason://inbox",
        name: "Jason MCP inbox",
        description: `File-backed Jason request inbox at ${queueDir()}`,
        mimeType: "application/json"
      }
    ]
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    if (request.params.uri !== "jason://inbox") {
      throw new Error(`Unknown resource: ${request.params.uri}`);
    }
    const requests = await listRequests({ limit: 50 });
    return {
      contents: [
        {
          uri: "jason://inbox",
          mimeType: "application/json",
          text: JSON.stringify({ queueDir: queueDir(), requests }, null, 2)
        }
      ]
    };
  });

  return server;
}

export async function runServer() {
  const server = await createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

function toolJson(value) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(value, null, 2)
      }
    ]
  };
}
