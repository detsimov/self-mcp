import {db, randomUUID} from "../db.js";

export interface Folder {
    id: string;
    name: string;
    created_at: string;
    updated_at: string;
}

export function listFolders(): {id: string; name: string}[] {
    return db.prepare("SELECT id, name FROM folders ORDER BY name").all() as {id: string; name: string}[];
}

export function getFolderByName(name: string): Folder | undefined {
    return db.prepare("SELECT * FROM folders WHERE name = ?").get(name) as Folder | undefined;
}

export function createFolder(name: string): {id: string; name: string} {
    const id = randomUUID();
    const now = new Date().toISOString();
    db.prepare("INSERT INTO folders (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)").run(id, name, now, now);
    return {id, name};
}

export function deleteFolder(id: string): void {
    const result = db.prepare("DELETE FROM folders WHERE id = ?").run(id);
    if (result.changes === 0) throw new Error(`Folder not found: ${id}`);
}

export function batchDeleteFolders(ids: string[]): {deleted: string[]; errors: {id: string; error: string}[]} {
    const deleted: string[] = [];
    const errors: {id: string; error: string}[] = [];
    for (const id of ids) {
        try {
            const result = db.prepare("DELETE FROM folders WHERE id = ?").run(id);
            if (result.changes === 0) errors.push({id, error: `Folder not found: ${id}`});
            else deleted.push(id);
        } catch (e: any) {
            errors.push({id, error: e.message});
        }
    }
    return {deleted, errors};
}
