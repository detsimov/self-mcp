import { db, randomUUID } from "../db.js";
export function listFolders() {
    return db.prepare("SELECT id, name FROM folders ORDER BY name").all();
}
export function getFolderByName(name) {
    return db.prepare("SELECT * FROM folders WHERE name = ?").get(name);
}
export function createFolder(name) {
    const id = randomUUID();
    const now = new Date().toISOString();
    db.prepare("INSERT INTO folders (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)").run(id, name, now, now);
    return { id, name };
}
export function deleteFolder(id) {
    const result = db.prepare("DELETE FROM folders WHERE id = ?").run(id);
    if (result.changes === 0)
        throw new Error(`Folder not found: ${id}`);
}
