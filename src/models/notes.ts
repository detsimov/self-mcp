import {db, randomUUID} from "../db.js";
import {getFolderByName, createFolder as createFolderRow} from "./folders.js";

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
