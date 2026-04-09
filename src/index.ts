import {createServer} from "node:http";
import {McpServer, WebStandardStreamableHTTPServerTransport} from "@modelcontextprotocol/server";
import {z} from "zod";
import {batchDeleteFolders} from "./models/folders.js";
import {getNote, upsertNote, searchNotes, batchDeleteNotes, getWorkspaceOverview, getNoteWithReminders} from "./models/notes.js";
import {createReminder, batchDeleteReminders} from "./models/reminders.js";
import {withTransaction} from "./db.js";
import {startReminderChecker} from "./reminder-checker.js";

const server = new McpServer({
    name: "self-mcp",
    version: "3.0.0",
});

// --- Tool 1: overview ---

server.registerTool("overview", {
    description: "Get a workspace snapshot: all folders, notes metadata, and upcoming reminders. Call this first to orient yourself.",
    inputSchema: z.object({}),
    outputSchema: z.object({
        folders: z.array(z.object({id: z.string(), name: z.string()})),
        notes: z.array(z.object({
            id: z.string(), name: z.string(), folder: z.string(),
            creationDate: z.string(), modificationDate: z.string(),
        })),
        upcomingReminders: z.array(z.object({
            id: z.string(), remindAt: z.string(), message: z.string().nullable(),
            noteId: z.string(), noteName: z.string(),
        })),
    }),
}, async () => {
    try {
        const result = getWorkspaceOverview();
        return {structuredContent: result, content: [{type: "text", text: JSON.stringify(result, null, 2)}]};
    } catch (e: any) {
        return {content: [{type: "text", text: `Error: ${e.message}`}], isError: true};
    }
});

// --- Tool 2: save_note ---

const NoteItemSchema = z.object({
    title: z.string().describe("Note title (used as upsert key)"),
    body: z.string().optional().describe("Body content (markdown). Omit to leave existing content unchanged."),
    folder: z.string().optional().describe("Folder name — auto-created if missing"),
    reminder: z.object({
        remindAt: z.string().describe("ISO datetime for the reminder"),
        message: z.string().optional().describe("Optional reminder message"),
    }).optional(),
});

server.registerTool("save_note", {
    description: "Create or update notes. Single mode: pass {title, body?, folder?, reminder?}. Batch mode: pass {notes: [...]}. Upserts by title — updates if exists, creates if not. Omitting body on an existing note only adds the reminder without touching content. Auto-creates folders. Single mode runs in a transaction.",
    inputSchema: z.object({
        title: z.string().optional().describe("Single-note mode: note title"),
        body: z.string().optional().describe("Single-note mode: note body"),
        folder: z.string().optional().describe("Single-note mode: folder name"),
        reminder: z.object({
            remindAt: z.string(),
            message: z.string().optional(),
        }).optional().describe("Single-note mode: optional reminder"),
        notes: z.array(NoteItemSchema).optional().describe("Batch mode: array of notes to save"),
    }),
    outputSchema: z.object({
        saved: z.array(z.object({id: z.string(), name: z.string(), created: z.boolean()})),
        errors: z.array(z.object({title: z.string(), error: z.string()})),
    }),
}, async (input) => {
    try {
        const isBatch = !!input.notes;
        const items = input.notes ?? (input.title ? [{
            title: input.title,
            body: input.body,
            folder: input.folder,
            reminder: input.reminder,
        }] : null);

        if (!items) {
            return {content: [{type: "text", text: "Error: Provide 'title' (single mode) or 'notes' (batch mode)"}], isError: true};
        }

        const saved: {id: string; name: string; created: boolean}[] = [];
        const errors: {title: string; error: string}[] = [];

        if (!isBatch) {
            // Single mode: transactional
            try {
                const r = withTransaction(() => {
                    const {id, name, created} = upsertNote(items[0].title, items[0].body, items[0].folder);
                    if (items[0].reminder) {
                        createReminder(id, items[0].reminder.remindAt, items[0].reminder.message);
                    }
                    return {id, name, created};
                });
                saved.push(r);
            } catch (e: any) {
                errors.push({title: items[0].title, error: e.message});
            }
        } else {
            // Batch mode: collect errors per item
            for (const item of items) {
                try {
                    const {id, name, created} = upsertNote(item.title, item.body, item.folder);
                    if (item.reminder) {
                        createReminder(id, item.reminder.remindAt, item.reminder.message);
                    }
                    saved.push({id, name, created});
                } catch (e: any) {
                    errors.push({title: item.title, error: e.message});
                }
            }
        }

        const result = {saved, errors};
        return {structuredContent: result, content: [{type: "text", text: JSON.stringify(result, null, 2)}]};
    } catch (e: any) {
        return {content: [{type: "text", text: `Error: ${e.message}`}], isError: true};
    }
});

// --- Tool 3: find_notes ---

server.registerTool("find_notes", {
    description: "Full-text search across note titles and bodies. Returns matching notes with snippets, optionally with full body.",
    inputSchema: z.object({
        query: z.string().describe("Search query"),
        folder: z.string().optional().describe("Limit search to this folder name"),
        includeBody: z.boolean().optional().describe("Include full note body in results (default false)"),
    }),
    outputSchema: z.object({
        results: z.array(z.object({
            id: z.string(), name: z.string(), folder: z.string(),
            snippet: z.string(), body: z.string().optional(),
        })),
    }),
}, async ({query, folder, includeBody}: {query: string; folder?: string; includeBody?: boolean}) => {
    try {
        const matches = searchNotes(query, folder);
        const results = includeBody
            ? matches.map(m => ({...m, body: getNote(m.name).body}))
            : matches;
        const out = {results};
        return {structuredContent: out, content: [{type: "text", text: JSON.stringify(out, null, 2)}]};
    } catch (e: any) {
        return {content: [{type: "text", text: `Error: ${e.message}`}], isError: true};
    }
});

// --- Tool 4: get_note ---

server.registerTool("get_note", {
    description: "Get a single note's full content and all its reminders by title",
    inputSchema: z.object({
        name: z.string().describe("Note title"),
    }),
    outputSchema: z.object({
        id: z.string(), name: z.string(), body: z.string(), folder: z.string(),
        creationDate: z.string(), modificationDate: z.string(),
        reminders: z.array(z.object({
            id: z.string(), remindAt: z.string(),
            message: z.string().nullable(), triggered: z.number(),
        })),
    }),
}, async ({name}: {name: string}) => {
    try {
        const note = getNoteWithReminders(name);
        const out = {...note} as Record<string, unknown>;
        return {structuredContent: out, content: [{type: "text", text: JSON.stringify(note, null, 2)}]};
    } catch (e: any) {
        return {content: [{type: "text", text: `Error: ${e.message}`}], isError: true};
    }
});

// --- Tool 5: delete ---

server.registerTool("delete", {
    description: "Batch delete notes, folders (cascades to notes), and/or reminders by ID",
    inputSchema: z.object({
        notes: z.array(z.string()).optional().describe("Note IDs to delete"),
        folders: z.array(z.string()).optional().describe("Folder IDs to delete (cascades to all notes inside)"),
        reminders: z.array(z.string()).optional().describe("Reminder IDs to delete"),
    }),
    outputSchema: z.object({
        deleted: z.object({
            notes: z.array(z.string()),
            folders: z.array(z.string()),
            reminders: z.array(z.string()),
        }),
        errors: z.array(z.object({id: z.string(), error: z.string()})),
    }),
}, async ({notes, folders, reminders}: {notes?: string[]; folders?: string[]; reminders?: string[]}) => {
    try {
        const allErrors: {id: string; error: string}[] = [];
        const deletedNotes: string[] = [];
        const deletedFolders: string[] = [];
        const deletedReminders: string[] = [];

        if (notes?.length) {
            const r = batchDeleteNotes(notes);
            deletedNotes.push(...r.deleted);
            allErrors.push(...r.errors);
        }
        if (folders?.length) {
            const r = batchDeleteFolders(folders);
            deletedFolders.push(...r.deleted);
            allErrors.push(...r.errors);
        }
        if (reminders?.length) {
            const r = batchDeleteReminders(reminders);
            deletedReminders.push(...r.deleted);
            allErrors.push(...r.errors);
        }

        const result = {
            deleted: {notes: deletedNotes, folders: deletedFolders, reminders: deletedReminders},
            errors: allErrors,
        };
        return {structuredContent: result, content: [{type: "text", text: JSON.stringify(result, null, 2)}]};
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
