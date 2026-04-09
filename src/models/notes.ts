import {db, randomUUID} from "../db.js";
import {getFolderByName, createFolder as createFolderRow} from "./folders.js";

export interface ReminderInfo {
    id: string;
    remindAt: string;
    message: string | null;
    triggered: number;
}

export interface NoteWithReminders extends NoteDetail {
    reminders: ReminderInfo[];
}

export interface NoteMeta {
    id: string;
    name: string;
    folder: string;
    creationDate: string;
    modificationDate: string;
}

export interface NoteDetail extends NoteMeta {
    body: string;
}

export function listNotes(folderName?: string): NoteMeta[] {
    if (folderName) {
        return db.prepare(`
            SELECT n.id, n.title AS name, f.name AS folder,
                   n.created_at AS creationDate, n.updated_at AS modificationDate
            FROM notes n JOIN folders f ON n.folder_id = f.id
            WHERE f.name = ?
            ORDER BY n.updated_at DESC
        `).all(folderName) as NoteMeta[];
    }
    return db.prepare(`
        SELECT n.id, n.title AS name, f.name AS folder,
               n.created_at AS creationDate, n.updated_at AS modificationDate
        FROM notes n JOIN folders f ON n.folder_id = f.id
        ORDER BY n.updated_at DESC
    `).all() as NoteMeta[];
}

export function getNote(title: string): NoteDetail {
    const note = db.prepare(`
        SELECT n.id, n.title AS name, n.body, f.name AS folder,
               n.created_at AS creationDate, n.updated_at AS modificationDate
        FROM notes n JOIN folders f ON n.folder_id = f.id
        WHERE n.title = ?
    `).get(title) as NoteDetail | undefined;
    if (!note) throw new Error(`Note not found: ${title}`);
    return note;
}

export function createNote(title: string, body: string, folderName?: string): {id: string; name: string} {
    const folder = folderName
        ? getFolderByName(folderName) ?? createFolderRow(folderName)
        : getFolderByName("Notes") ?? createFolderRow("Notes");

    const id = randomUUID();
    const now = new Date().toISOString();
    db.prepare(
        "INSERT INTO notes (id, title, body, folder_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(id, title, body, folder.id, now, now);
    return {id, name: title};
}

export function updateNote(title: string, body: string, newTitle?: string): {id: string; name: string} {
    const now = new Date().toISOString();
    const finalTitle = newTitle ?? title;
    const result = db.prepare(
        "UPDATE notes SET body = ?, title = ?, updated_at = ? WHERE title = ?"
    ).run(body, finalTitle, now, title);
    if (result.changes === 0) throw new Error(`Note not found: ${title}`);
    const note = db.prepare("SELECT id FROM notes WHERE title = ?").get(finalTitle) as {id: string};
    return {id: note.id, name: finalTitle};
}

export function deleteNote(id: string): void {
    const result = db.prepare("DELETE FROM notes WHERE id = ?").run(id);
    if (result.changes === 0) throw new Error(`Note not found: ${id}`);
}

export function upsertNote(title: string, body?: string, folderName?: string): {id: string; name: string; created: boolean} {
    const existing = db.prepare("SELECT id FROM notes WHERE title = ?").get(title) as {id: string} | undefined;
    if (existing) {
        if (body !== undefined) {
            const now = new Date().toISOString();
            db.prepare("UPDATE notes SET body = ?, updated_at = ? WHERE id = ?").run(body, now, existing.id);
        }
        return {id: existing.id, name: title, created: false};
    }
    const folder = folderName
        ? getFolderByName(folderName) ?? createFolderRow(folderName)
        : getFolderByName("Notes") ?? createFolderRow("Notes");
    const id = randomUUID();
    const now = new Date().toISOString();
    db.prepare(
        "INSERT INTO notes (id, title, body, folder_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(id, title, body ?? "", folder.id, now, now);
    return {id, name: title, created: true};
}

export function getNoteWithReminders(title: string): NoteWithReminders {
    const note = getNote(title);
    const reminders = db.prepare(`
        SELECT id, remind_at AS remindAt, message, triggered
        FROM reminders WHERE note_id = ? ORDER BY remind_at ASC
    `).all(note.id) as ReminderInfo[];
    return {...note, reminders};
}

export function getWorkspaceOverview(): {
    folders: {id: string; name: string}[];
    notes: NoteMeta[];
    upcomingReminders: {id: string; remindAt: string; message: string | null; noteId: string; noteName: string}[];
} {
    const folders = db.prepare("SELECT id, name FROM folders ORDER BY name").all() as {id: string; name: string}[];
    const notes = db.prepare(`
        SELECT n.id, n.title AS name, f.name AS folder,
               n.created_at AS creationDate, n.updated_at AS modificationDate
        FROM notes n JOIN folders f ON n.folder_id = f.id
        ORDER BY n.updated_at DESC
    `).all() as NoteMeta[];
    const upcomingReminders = db.prepare(`
        SELECT r.id, r.remind_at AS remindAt, r.message, r.note_id AS noteId, n.title AS noteName
        FROM reminders r JOIN notes n ON r.note_id = n.id
        WHERE r.triggered = 0 ORDER BY r.remind_at ASC
    `).all() as {id: string; remindAt: string; message: string | null; noteId: string; noteName: string}[];
    return {folders, notes, upcomingReminders};
}

export function batchDeleteNotes(ids: string[]): {deleted: string[]; errors: {id: string; error: string}[]} {
    const deleted: string[] = [];
    const errors: {id: string; error: string}[] = [];
    for (const id of ids) {
        try {
            const result = db.prepare("DELETE FROM notes WHERE id = ?").run(id);
            if (result.changes === 0) errors.push({id, error: `Note not found: ${id}`});
            else deleted.push(id);
        } catch (e: any) {
            errors.push({id, error: e.message});
        }
    }
    return {deleted, errors};
}

export function searchNotes(query: string, folderName?: string): {id: string; name: string; folder: string; snippet: string}[] {
    const ftsQuery = query.replace(/['"]/g, "").split(/\s+/).map(w => `"${w}"`).join(" ");

    if (folderName) {
        return db.prepare(`
            SELECT n.id, n.title AS name, f.name AS folder,
                   snippet(notes_fts, 1, '>>>', '<<<', '...', 40) AS snippet
            FROM notes_fts
            JOIN notes n ON n.rowid = notes_fts.rowid
            JOIN folders f ON n.folder_id = f.id
            WHERE notes_fts MATCH ? AND f.name = ?
            ORDER BY rank
        `).all(ftsQuery, folderName) as {id: string; name: string; folder: string; snippet: string}[];
    }

    return db.prepare(`
        SELECT n.id, n.title AS name, f.name AS folder,
               snippet(notes_fts, 1, '>>>', '<<<', '...', 40) AS snippet
        FROM notes_fts
        JOIN notes n ON n.rowid = notes_fts.rowid
        JOIN folders f ON n.folder_id = f.id
        WHERE notes_fts MATCH ?
        ORDER BY rank
    `).all(ftsQuery) as {id: string; name: string; folder: string; snippet: string}[];
}
