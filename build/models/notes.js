import { db, randomUUID } from "../db.js";
import { getFolderByName, createFolder as createFolderRow } from "./folders.js";
export function listNotes(folderName) {
    if (folderName) {
        return db.prepare(`
            SELECT n.id, n.title AS name, f.name AS folder,
                   n.created_at AS creationDate, n.updated_at AS modificationDate
            FROM notes n JOIN folders f ON n.folder_id = f.id
            WHERE f.name = ?
            ORDER BY n.updated_at DESC
        `).all(folderName);
    }
    return db.prepare(`
        SELECT n.id, n.title AS name, f.name AS folder,
               n.created_at AS creationDate, n.updated_at AS modificationDate
        FROM notes n JOIN folders f ON n.folder_id = f.id
        ORDER BY n.updated_at DESC
    `).all();
}
export function getNote(title) {
    const note = db.prepare(`
        SELECT n.id, n.title AS name, n.body, f.name AS folder,
               n.created_at AS creationDate, n.updated_at AS modificationDate
        FROM notes n JOIN folders f ON n.folder_id = f.id
        WHERE n.title = ?
    `).get(title);
    if (!note)
        throw new Error(`Note not found: ${title}`);
    return note;
}
export function createNote(title, body, folderName) {
    const folder = folderName
        ? getFolderByName(folderName) ?? createFolderRow(folderName)
        : getFolderByName("Notes") ?? createFolderRow("Notes");
    const id = randomUUID();
    const now = new Date().toISOString();
    db.prepare("INSERT INTO notes (id, title, body, folder_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(id, title, body, folder.id, now, now);
    return { id, name: title };
}
export function updateNote(title, body, newTitle) {
    const now = new Date().toISOString();
    const finalTitle = newTitle ?? title;
    const result = db.prepare("UPDATE notes SET body = ?, title = ?, updated_at = ? WHERE title = ?").run(body, finalTitle, now, title);
    if (result.changes === 0)
        throw new Error(`Note not found: ${title}`);
    const note = db.prepare("SELECT id FROM notes WHERE title = ?").get(finalTitle);
    return { id: note.id, name: finalTitle };
}
export function deleteNote(id) {
    const result = db.prepare("DELETE FROM notes WHERE id = ?").run(id);
    if (result.changes === 0)
        throw new Error(`Note not found: ${id}`);
}
export function searchNotes(query, folderName) {
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
        `).all(ftsQuery, folderName);
    }
    return db.prepare(`
        SELECT n.id, n.title AS name, f.name AS folder,
               snippet(notes_fts, 1, '>>>', '<<<', '...', 40) AS snippet
        FROM notes_fts
        JOIN notes n ON n.rowid = notes_fts.rowid
        JOIN folders f ON n.folder_id = f.id
        WHERE notes_fts MATCH ?
        ORDER BY rank
    `).all(ftsQuery);
}
