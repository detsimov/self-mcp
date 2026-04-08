import {createServer} from "node:http";
import {McpServer, WebStandardStreamableHTTPServerTransport} from "@modelcontextprotocol/server";
import {z} from "zod";
import {listFolders, createFolder, deleteFolder} from "./models/folders.js";
import {listNotes, getNote, createNote, updateNote, deleteNote, searchNotes} from "./models/notes.js";
import {createReminder, listReminders, deleteReminder} from "./models/reminders.js";
import {startReminderChecker} from "./reminder-checker.js";

const server = new McpServer({
    name: "self-mcp",
    version: "2.0.0",
});

// --- Folder tools ---

server.registerTool("list_folders", {
    description: "List all folders",
    inputSchema: z.object({}),
    outputSchema: z.object({folders: z.array(z.object({id: z.string(), name: z.string()}))}),
}, async () => {
    try {
        const folders = listFolders();
        return {structuredContent: {folders}, content: [{type: "text", text: JSON.stringify(folders, null, 2)}]};
    } catch (e: any) {
        return {content: [{type: "text", text: `Error: ${e.message}`}], isError: true};
    }
});

server.registerTool("create_folder", {
    description: "Create a new folder",
    inputSchema: z.object({
        name: z.string().describe("Name of the new folder"),
    }),
    outputSchema: z.object({id: z.string(), name: z.string()}),
}, async ({name}: {name: string}) => {
    try {
        const result = createFolder(name);
        return {structuredContent: result, content: [{type: "text", text: JSON.stringify(result, null, 2)}]};
    } catch (e: any) {
        return {content: [{type: "text", text: `Error: ${e.message}`}], isError: true};
    }
});

server.registerTool("delete_folder", {
    description: "Delete a folder and all its notes",
    inputSchema: z.object({
        id: z.string().describe("ID of the folder to delete"),
    }),
    outputSchema: z.object({success: z.boolean()}),
}, async ({id}: {id: string}) => {
    try {
        deleteFolder(id);
        return {structuredContent: {success: true}, content: [{type: "text", text: "Folder deleted"}]};
    } catch (e: any) {
        return {content: [{type: "text", text: `Error: ${e.message}`}], isError: true};
    }
});

// --- Note tools ---

server.registerTool("list_notes", {
    description: "List notes, optionally filtered by folder name",
    inputSchema: z.object({
        folder: z.string().optional().describe("Folder name to filter notes (omit for all folders)"),
    }),
    outputSchema: z.object({
        notes: z.array(z.object({
            id: z.string(), name: z.string(), folder: z.string(),
            creationDate: z.string(), modificationDate: z.string(),
        })),
    }),
}, async ({folder}: {folder?: string}) => {
    try {
        const notes = listNotes(folder);
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
    outputSchema: z.object({
        id: z.string(), name: z.string(), body: z.string(), folder: z.string(),
        creationDate: z.string(), modificationDate: z.string(),
    }),
}, async ({name}: {name: string}) => {
    try {
        const note = getNote(name);
        return {structuredContent: {...note}, content: [{type: "text", text: JSON.stringify(note, null, 2)}]};
    } catch (e: any) {
        return {content: [{type: "text", text: `Error: ${e.message}`}], isError: true};
    }
});

server.registerTool("create_note", {
    description: "Create a new note with markdown body",
    inputSchema: z.object({
        title: z.string().describe("Title of the new note"),
        body: z.string().describe("Body content of the note (markdown)"),
        folder: z.string().optional().describe("Folder to create the note in (omit for default 'Notes' folder)"),
    }),
    outputSchema: z.object({id: z.string(), name: z.string()}),
}, async ({title, body, folder}: {title: string; body: string; folder?: string}) => {
    try {
        const result = createNote(title, body, folder);
        return {structuredContent: result, content: [{type: "text", text: JSON.stringify(result, null, 2)}]};
    } catch (e: any) {
        return {content: [{type: "text", text: `Error: ${e.message}`}], isError: true};
    }
});

server.registerTool("update_note", {
    description: "Update an existing note's content (and optionally its title)",
    inputSchema: z.object({
        name: z.string().describe("Current title of the note to update"),
        body: z.string().describe("New body content (markdown)"),
        title: z.string().optional().describe("New title for the note (omit to keep current title)"),
    }),
    outputSchema: z.object({id: z.string(), name: z.string()}),
}, async ({name, body, title}: {name: string; body: string; title?: string}) => {
    try {
        const result = updateNote(name, body, title);
        return {structuredContent: result, content: [{type: "text", text: JSON.stringify(result, null, 2)}]};
    } catch (e: any) {
        return {content: [{type: "text", text: `Error: ${e.message}`}], isError: true};
    }
});

server.registerTool("delete_note", {
    description: "Delete a note by its ID",
    inputSchema: z.object({
        id: z.string().describe("ID of the note to delete"),
    }),
    outputSchema: z.object({success: z.boolean()}),
}, async ({id}: {id: string}) => {
    try {
        deleteNote(id);
        return {structuredContent: {success: true}, content: [{type: "text", text: "Note deleted"}]};
    } catch (e: any) {
        return {content: [{type: "text", text: `Error: ${e.message}`}], isError: true};
    }
});

server.registerTool("search_notes", {
    description: "Search notes by keyword (full-text search in titles and content)",
    inputSchema: z.object({
        query: z.string().describe("Search term to find in note titles or content"),
        folder: z.string().optional().describe("Folder to search in (omit to search all folders)"),
    }),
    outputSchema: z.object({
        results: z.array(z.object({
            id: z.string(), name: z.string(), folder: z.string(), snippet: z.string(),
        })),
    }),
}, async ({query, folder}: {query: string; folder?: string}) => {
    try {
        const results = searchNotes(query, folder);
        return {structuredContent: {results}, content: [{type: "text", text: JSON.stringify(results, null, 2)}]};
    } catch (e: any) {
        return {content: [{type: "text", text: `Error: ${e.message}`}], isError: true};
    }
});

// --- Reminder tools ---

server.registerTool("create_reminder", {
    description: "Create a reminder for a note. When triggered, sends a webhook notification.",
    inputSchema: z.object({
        noteId: z.string().describe("ID of the note to attach the reminder to"),
        remindAt: z.string().describe("ISO datetime when to trigger the reminder (e.g. '2026-04-10T09:00:00Z')"),
        message: z.string().optional().describe("Optional reminder message"),
    }),
    outputSchema: z.object({id: z.string(), noteId: z.string(), remindAt: z.string()}),
}, async ({noteId, remindAt, message}: {noteId: string; remindAt: string; message?: string}) => {
    try {
        const result = createReminder(noteId, remindAt, message);
        return {structuredContent: result, content: [{type: "text", text: JSON.stringify(result, null, 2)}]};
    } catch (e: any) {
        return {content: [{type: "text", text: `Error: ${e.message}`}], isError: true};
    }
});

server.registerTool("list_reminders", {
    description: "List reminders, optionally filtered by note ID or upcoming only",
    inputSchema: z.object({
        noteId: z.string().optional().describe("Filter reminders by note ID"),
        upcoming: z.boolean().optional().describe("Show only upcoming (not yet triggered) reminders"),
    }),
    outputSchema: z.object({
        reminders: z.array(z.object({
            id: z.string(), note_id: z.string(), remind_at: z.string(),
            message: z.string().nullable(), triggered: z.number(),
            triggered_at: z.string().nullable(), created_at: z.string(),
        })),
    }),
}, async ({noteId, upcoming}: {noteId?: string; upcoming?: boolean}) => {
    try {
        const reminders = listReminders(noteId, upcoming);
        return {structuredContent: {reminders}, content: [{type: "text", text: JSON.stringify(reminders, null, 2)}]};
    } catch (e: any) {
        return {content: [{type: "text", text: `Error: ${e.message}`}], isError: true};
    }
});

server.registerTool("delete_reminder", {
    description: "Delete a reminder by its ID",
    inputSchema: z.object({
        id: z.string().describe("ID of the reminder to delete"),
    }),
    outputSchema: z.object({success: z.boolean()}),
}, async ({id}: {id: string}) => {
    try {
        deleteReminder(id);
        return {structuredContent: {success: true}, content: [{type: "text", text: "Reminder deleted"}]};
    } catch (e: any) {
        return {content: [{type: "text", text: `Error: ${e.message}`}], isError: true};
    }
});

// --- Server setup ---

const PORT = Number(process.env.PORT) || 3001;

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

startReminderChecker();

httpServer.listen(PORT, () => {
    console.log(`MCP server listening on http://localhost:${PORT}/mcp`);
});
