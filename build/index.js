import { createServer } from "node:http";
import { McpServer, WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import { z } from "zod";
const server = new McpServer({
    name: "self-mcp",
    version: "1.0.0",
});
server.registerTool("hello", {
    description: "Say hello to someone",
    inputSchema: z.object({ name: z.string() }),
}, async ({ name }) => ({
    content: [{ type: "text", text: `hello ${name}` }],
}));
server.registerTool("bye", {
    description: "Say bye to someone",
    inputSchema: z.object({ name: z.string() }),
}, async ({ name }) => ({
    content: [{ type: "text", text: `bye ${name}` }],
}));
const PORT = Number(process.env.PORT) || 3000;
const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
const httpServer = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
    if (url.pathname !== "/mcp") {
        res.writeHead(404).end("Not found");
        return;
    }
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
        if (value)
            headers.set(key, Array.isArray(value) ? value.join(", ") : value);
    }
    const body = await new Promise((resolve) => {
        let data = "";
        req.on("data", (chunk) => (data += chunk));
        req.on("end", () => resolve(data));
    });
    const webReq = new Request(url, {
        method: req.method,
        headers,
        body: ["GET", "HEAD"].includes(req.method) ? undefined : body,
    });
    const webRes = await transport.handleRequest(webReq);
    res.writeHead(webRes.status, Object.fromEntries(webRes.headers.entries()));
    const resBody = await webRes.text();
    res.end(resBody);
});
await server.connect(transport);
httpServer.listen(PORT, () => {
    console.log(`MCP server listening on http://localhost:${PORT}/mcp`);
});
