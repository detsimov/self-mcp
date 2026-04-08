import {db, randomUUID} from "../db.js";

export interface Reminder {
    id: string;
    note_id: string;
    remind_at: string;
    message: string | null;
    triggered: number;
    triggered_at: string | null;
    created_at: string;
}

export interface PendingReminder extends Reminder {
    note_title: string;
    note_body: string;
    folder_name: string;
}

/** Normalize any datetime string to local time in "YYYY-MM-DD HH:MM:SS" format for SQLite comparison */
function toLocalDatetime(input: string): string {
    const d = new Date(input);
    if (isNaN(d.getTime())) throw new Error(`Invalid datetime: ${input}`);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function createReminder(noteId: string, remindAt: string, message?: string): {id: string; noteId: string; remindAt: string} {
    // Verify note exists
    const note = db.prepare("SELECT id FROM notes WHERE id = ?").get(noteId);
    if (!note) throw new Error(`Note not found: ${noteId}`);

    const normalizedRemindAt = toLocalDatetime(remindAt);
    const id = randomUUID();
    const now = new Date().toISOString();
    db.prepare(
        "INSERT INTO reminders (id, note_id, remind_at, message, created_at) VALUES (?, ?, ?, ?, ?)"
    ).run(id, noteId, normalizedRemindAt, message ?? null, now);
    return {id, noteId, remindAt: normalizedRemindAt};
}

export function listReminders(noteId?: string, upcomingOnly?: boolean): Reminder[] {
    let sql = "SELECT * FROM reminders WHERE 1=1";
    const params: unknown[] = [];

    if (noteId) {
        sql += " AND note_id = ?";
        params.push(noteId);
    }
    if (upcomingOnly) {
        sql += " AND triggered = 0";
    }

    sql += " ORDER BY remind_at ASC";
    return db.prepare(sql).all(...params) as Reminder[];
}

export function deleteReminder(id: string): void {
    const result = db.prepare("DELETE FROM reminders WHERE id = ?").run(id);
    if (result.changes === 0) throw new Error(`Reminder not found: ${id}`);
}

export function getPendingReminders(): PendingReminder[] {
    return db.prepare(`
        SELECT r.*, n.title AS note_title, n.body AS note_body, f.name AS folder_name
        FROM reminders r
        JOIN notes n ON r.note_id = n.id
        JOIN folders f ON n.folder_id = f.id
        WHERE r.triggered = 0 AND r.remind_at <= datetime('now', 'localtime')
        ORDER BY r.remind_at ASC
    `).all() as PendingReminder[];
}

export function markTriggered(id: string): void {
    const now = new Date().toISOString();
    db.prepare("UPDATE reminders SET triggered = 1, triggered_at = ? WHERE id = ?").run(now, id);
}
