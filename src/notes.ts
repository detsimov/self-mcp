import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {z} from "zod";

const exec = promisify(execFile);

async function runJxa(script: string): Promise<string> {
    const {stdout} = await exec("osascript", ["-l", "JavaScript", "-e", script], {timeout: 15000});
    return stdout.trim();
}

function stripHtml(html: string): string {
    return html
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/div>/gi, "\n")
        .replace(/<\/p>/gi, "\n")
        .replace(/<[^>]*>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

/** Escape a string for safe embedding in JXA code */
function jxaStr(value: string): string {
    return JSON.stringify(value);
}

// --- Zod output schemas ---

const folderSchema = z.object({
    name: z.string(),
    id: z.string(),
});

const noteMetaSchema = z.object({
    id: z.string(),
    name: z.string(),
    folder: z.string(),
    creationDate: z.string(),
    modificationDate: z.string(),
});

const noteDetailSchema = noteMetaSchema.extend({
    body: z.string().describe("Plain text content of the note"),
    bodyHtml: z.string().describe("Raw HTML content of the note"),
});

const noteRefSchema = z.object({
    id: z.string(),
    name: z.string(),
});

const noteSearchResultSchema = z.object({
    id: z.string(),
    name: z.string(),
    folder: z.string(),
    snippet: z.string(),
});

const folderRefSchema = z.object({
    id: z.string(),
    name: z.string(),
});

export const outputSchemas = {
    listFolders: z.object({folders: z.array(folderSchema)}),
    listNotes: z.object({notes: z.array(noteMetaSchema)}),
    getNote: noteDetailSchema,
    createNote: noteRefSchema,
    updateNote: noteRefSchema,
    searchNotes: z.object({results: z.array(noteSearchResultSchema)}),
    createFolder: folderRefSchema,
};

type Folder = z.infer<typeof folderSchema>;
type NoteMeta = z.infer<typeof noteMetaSchema>;
type NoteDetail = z.infer<typeof noteDetailSchema>;
type NoteRef = z.infer<typeof noteRefSchema>;
type NoteSearchResult = z.infer<typeof noteSearchResultSchema>;

export async function createFolder(name: string): Promise<{id: string; name: string}> {
    const script = `
        const Notes = Application("Notes");
        const f = Notes.Folder({ name: ${jxaStr(name)} });
        Notes.folders.push(f);
        JSON.stringify({ id: f.id(), name: f.name() });
    `;
    const result = await runJxa(script);
    return JSON.parse(result);
}

export async function listFolders(): Promise<Folder[]> {
    const script = `
        const Notes = Application("Notes");
        const folders = Notes.folders();
        JSON.stringify(folders.map(f => ({ name: f.name(), id: f.id() })));
    `;
    const result = await runJxa(script);
    return JSON.parse(result);
}

export async function listNotes(folder?: string): Promise<NoteMeta[]> {
    const folderFilter = folder ? `Notes.folders.byName(${jxaStr(folder)})` : null;
    const script = folder
        ? `
        const Notes = Application("Notes");
        const folder = Notes.folders.byName(${jxaStr(folder)});
        const notes = folder.notes();
        JSON.stringify(notes.map(n => ({
            id: n.id(),
            name: n.name(),
            folder: ${jxaStr(folder)},
            creationDate: n.creationDate().toISOString(),
            modificationDate: n.modificationDate().toISOString()
        })));
    `
        : `
        const Notes = Application("Notes");
        const result = [];
        const folders = Notes.folders();
        for (const f of folders) {
            const folderName = f.name();
            const notes = f.notes();
            for (const n of notes) {
                result.push({
                    id: n.id(),
                    name: n.name(),
                    folder: folderName,
                    creationDate: n.creationDate().toISOString(),
                    modificationDate: n.modificationDate().toISOString()
                });
            }
        }
        JSON.stringify(result);
    `;
    const result = await runJxa(script);
    return JSON.parse(result);
}

export async function getNote(name: string): Promise<NoteDetail> {
    const script = `
        const Notes = Application("Notes");
        let found = null;
        const folders = Notes.folders();
        for (const f of folders) {
            const notes = f.notes();
            for (const n of notes) {
                if (n.name() === ${jxaStr(name)}) {
                    found = {
                        id: n.id(),
                        name: n.name(),
                        bodyHtml: n.body(),
                        folder: f.name(),
                        creationDate: n.creationDate().toISOString(),
                        modificationDate: n.modificationDate().toISOString()
                    };
                    break;
                }
            }
            if (found) break;
        }
        if (!found) throw new Error("Note not found: " + ${jxaStr(name)});
        JSON.stringify(found);
    `;
    const result = await runJxa(script);
    const note = JSON.parse(result);
    return {...note, body: stripHtml(note.bodyHtml)};
}

export async function createNote(title: string, body: string, folder?: string): Promise<{id: string; name: string}> {
    const targetFolder = folder ? `Notes.folders.byName(${jxaStr(folder)})` : `Notes.defaultAccount().defaultFolder()`;
    const script = `
        const Notes = Application("Notes");
        const folder = ${targetFolder};
        const n = Notes.Note({ name: ${jxaStr(title)}, body: ${jxaStr(body)} });
        folder.notes.push(n);
        JSON.stringify({ id: n.id(), name: n.name() });
    `;
    const result = await runJxa(script);
    return JSON.parse(result);
}

export async function updateNote(name: string, body: string, newTitle?: string): Promise<{id: string; name: string}> {
    const setTitle = newTitle ? `n.name = ${jxaStr(newTitle)};` : "";
    const script = `
        const Notes = Application("Notes");
        let found = false;
        const folders = Notes.folders();
        for (const f of folders) {
            const notes = f.notes();
            for (const n of notes) {
                if (n.name() === ${jxaStr(name)}) {
                    n.body = ${jxaStr(body)};
                    ${setTitle}
                    found = true;
                    JSON.stringify({ id: n.id(), name: n.name() });
                    break;
                }
            }
            if (found) break;
        }
        if (!found) throw new Error("Note not found: " + ${jxaStr(name)});
    `;
    const result = await runJxa(script);
    return JSON.parse(result);
}

export async function searchNotes(query: string, folder?: string): Promise<NoteSearchResult[]> {
    const queryLower = query.toLowerCase();
    const script = `
        const Notes = Application("Notes");
        const query = ${jxaStr(queryLower)};
        const results = [];
        const folders = ${folder ? `[Notes.folders.byName(${jxaStr(folder)})]` : `Notes.folders()`};
        for (const f of folders) {
            const folderName = f.name();
            const notes = f.notes();
            for (const n of notes) {
                const name = n.name();
                const body = n.body() || "";
                const nameLower = name.toLowerCase();
                const bodyLower = body.toLowerCase();
                if (nameLower.includes(query) || bodyLower.includes(query)) {
                    let snippet = "";
                    const plainBody = body.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ");
                    const idx = plainBody.toLowerCase().indexOf(query);
                    if (idx >= 0) {
                        const start = Math.max(0, idx - 60);
                        const end = Math.min(plainBody.length, idx + query.length + 60);
                        snippet = (start > 0 ? "..." : "") + plainBody.substring(start, end) + (end < plainBody.length ? "..." : "");
                    } else {
                        snippet = plainBody.substring(0, 120) + (plainBody.length > 120 ? "..." : "");
                    }
                    results.push({ id: n.id(), name: name, folder: folderName, snippet: snippet });
                }
            }
        }
        JSON.stringify(results);
    `;
    const result = await runJxa(script);
    return JSON.parse(result);
}
