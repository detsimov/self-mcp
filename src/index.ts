import {createServer} from "node:http";
import {McpServer, WebStandardStreamableHTTPServerTransport} from "@modelcontextprotocol/server";
import {z} from "zod";
import {listFolders, listNotes, getNote, createNote, createFolder, updateNote, searchNotes, outputSchemas} from "./notes.js";

const server = new McpServer({
    name: "self-mcp",
    version: "1.0.0",
});

server.registerTool("list_folders", {
    description: "List all folders in Apple Notes",
    inputSchema: z.object({}),
    outputSchema: outputSchemas.listFolders,
}, async () => {
    try {
        const folders = await listFolders();
        return {structuredContent: {folders}, content: [{type: "text", text: JSON.stringify(folders, null, 2)}]};
    } catch (e: any) {
        return {content: [{type: "text", text: `Error: ${e.message}`}], isError: true};
    }
});

server.registerTool("create_folder", {
    description: "Create a new folder in Apple Notes",
    inputSchema: z.object({
        name: z.string().describe("Name of the new folder"),
    }),
    outputSchema: outputSchemas.createFolder,
}, async ({name}: {name: string}) => {
    try {
        const result = await createFolder(name);
        return {structuredContent: result, content: [{type: "text", text: JSON.stringify(result, null, 2)}]};
    } catch (e: any) {
        return {content: [{type: "text", text: `Error: ${e.message}`}], isError: true};
    }
});

server.registerTool("list_notes", {
    description: "List notes in Apple Notes, optionally filtered by folder name",
    inputSchema: z.object({
        folder: z.string().optional().describe("Folder name to filter notes (omit for all folders)"),
    }),
    outputSchema: outputSchemas.listNotes,
}, async ({folder}: {folder?: string}) => {
    try {
        const notes = await listNotes(folder);
        return {structuredContent: {notes}, content: [{type: "text", text: JSON.stringify(notes, null, 2)}]};
    } catch (e: any) {
        return {content: [{type: "text", text: `Error: ${e.message}`}], isError: true};
    }
});

server.registerTool("get_note", {
    description: "Get the full content of a note by its title",
    inputSchema: z.object({
        name: z.string().describe("The title of the note to retrieve"),
    }),
    outputSchema: outputSchemas.getNote,
}, async ({name}: {name: string}) => {
    try {
        const note = await getNote(name);
        return {structuredContent: note, content: [{type: "text", text: JSON.stringify(note, null, 2)}]};
    } catch (e: any) {
        return {content: [{type: "text", text: `Error: ${e.message}`}], isError: true};
    }
});

server.registerTool("create_note", {
    description: "Create a new note in Apple Notes",
    inputSchema: z.object({
        title: z.string().describe("Title of the new note"),
        body: z.string().describe("Body content of the note (plain text or HTML)"),
        folder: z.string().optional().describe("Folder to create the note in (omit for default folder)"),
    }),
    outputSchema: outputSchemas.createNote,
}, async ({title, body, folder}: {title: string; body: string; folder?: string}) => {
    try {
        const result = await createNote(title, body, folder);
        return {structuredContent: result, content: [{type: "text", text: JSON.stringify(result, null, 2)}]};
    } catch (e: any) {
        return {content: [{type: "text", text: `Error: ${e.message}`}], isError: true};
    }
});

server.registerTool("update_note", {
    description: "Update an existing note's content (and optionally its title)",
    inputSchema: z.object({
        name: z.string().describe("Current title of the note to update"),
        body: z.string().describe("New body content (plain text or HTML)"),
        title: z.string().optional().describe("New title for the note (omit to keep current title)"),
    }),
    outputSchema: outputSchemas.updateNote,
}, async ({name, body, title}: {name: string; body: string; title?: string}) => {
    try {
        const result = await updateNote(name, body, title);
        return {structuredContent: result, content: [{type: "text", text: JSON.stringify(result, null, 2)}]};
    } catch (e: any) {
        return {content: [{type: "text", text: `Error: ${e.message}`}], isError: true};
    }
});

server.registerTool("search_notes", {
    description: "Search Apple Notes by keyword (searches both titles and content)",
    inputSchema: z.object({
        query: z.string().describe("Search term to find in note titles or content"),
        folder: z.string().optional().describe("Folder to search in (omit to search all folders)"),
    }),
    outputSchema: outputSchemas.searchNotes,
}, async ({query, folder}: {query: string; folder?: string}) => {
    try {
        const results = await searchNotes(query, folder);
        return {structuredContent: {results}, content: [{type: "text", text: JSON.stringify(results, null, 2)}]};
    } catch (e: any) {
        return {content: [{type: "text", text: `Error: ${e.message}`}], isError: true};
    }
});

const PORT = Number(process.env.PORT) || 3000;

const transport = new WebStandardStreamableHTTPServerTransport({enableJsonResponse: true});

const httpServer = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
    if (url.pathname !== "/mcp") {
        res.writeHead(404).end("Not found");
        return;
    }

    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
        if (value) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
    }

    const body = await new Promise<string>((resolve) => {
        let data = "";
        req.on("data", (chunk: Buffer) => (data += chunk));
        req.on("end", () => resolve(data));
    });

    const webReq = new Request(url, {
        method: req.method,
        headers,
        body: ["GET", "HEAD"].includes(req.method!) ? undefined : body,
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
