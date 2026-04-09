import { db, randomUUID } from "../db.js";
/** Normalize any datetime string to local time in "YYYY-MM-DD HH:MM:SS" format for SQLite comparison */
function toLocalDatetime(input) {
    const d = new Date(input);
    if (isNaN(d.getTime()))
        throw new Error(`Invalid datetime: ${input}`);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
export function createReminder(noteId, remindAt, message) {
    // Verify note exists
    const note = db.prepare("SELECT id FROM notes WHERE id = ?").get(noteId);
    if (!note)
        throw new Error(`Note not found: ${noteId}`);
    const normalizedRemindAt = toLocalDatetime(remindAt);
    const id = randomUUID();
    const now = new Date().toISOString();
    db.prepare("INSERT INTO reminders (id, note_id, remind_at, message, created_at) VALUES (?, ?, ?, ?, ?)").run(id, noteId, normalizedRemindAt, message ?? null, now);
    return { id, noteId, remindAt: normalizedRemindAt };
}
export function listReminders(noteId, upcomingOnly) {
    let sql = "SELECT * FROM reminders WHERE 1=1";
    const params = [];
    if (noteId) {
        sql += " AND note_id = ?";
        params.push(noteId);
    }
    if (upcomingOnly) {
        sql += " AND triggered = 0";
    }
    sql += " ORDER BY remind_at ASC";
    return db.prepare(sql).all(...params);
}
export function deleteReminder(id) {
    const result = db.prepare("DELETE FROM reminders WHERE id = ?").run(id);
    if (result.changes === 0)
        throw new Error(`Reminder not found: ${id}`);
}
export function getPendingReminders() {
    return db.prepare(`
        SELECT r.*, n.title AS note_title, n.body AS note_body, f.name AS folder_name
        FROM reminders r
        JOIN notes n ON r.note_id = n.id
        JOIN folders f ON n.folder_id = f.id
        WHERE r.triggered = 0 AND r.remind_at <= datetime('now', 'localtime')
        ORDER BY r.remind_at ASC
    `).all();
}
export function markTriggered(id) {
    const now = new Date().toISOString();
    db.prepare("UPDATE reminders SET triggered = 1, triggered_at = ? WHERE id = ?").run(now, id);
}
export function batchDeleteReminders(ids) {
    const deleted = [];
    const errors = [];
    for (const id of ids) {
        try {
            const result = db.prepare("DELETE FROM reminders WHERE id = ?").run(id);
            if (result.changes === 0)
                errors.push({ id, error: `Reminder not found: ${id}` });
            else
                deleted.push(id);
        }
        catch (e) {
            errors.push({ id, error: e.message });
        }
    }
    return { deleted, errors };
}
