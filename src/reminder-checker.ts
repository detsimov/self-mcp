import {getPendingReminders, markTriggered, type PendingReminder} from "./models/reminders.js";

const WEBHOOK_URL = process.env.WEBHOOK_URL || "http://localhost:3000/api/webhooks/notifications";
const SERVER_NAME = "self-mcp";
const INTERVAL_MS = Number(process.env.REMINDER_INTERVAL_MS) || 60_000;

async function sendWebhook(reminder: PendingReminder): Promise<boolean> {
    const title = reminder.message || `Напоминание: ${reminder.note_title}`;
    const details = [
        `Заметка: ${reminder.note_title}`,
        `Папка: ${reminder.folder_name}`,
        reminder.note_body.length > 200
            ? reminder.note_body.slice(0, 200) + "..."
            : reminder.note_body,
    ].join("\n");

    const body = {
        serverName: SERVER_NAME,
        type: "reminder",
        payload: {title, details},
    };

    try {
        const res = await fetch(WEBHOOK_URL, {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            console.error(`[reminder] Webhook failed for ${reminder.id}: ${res.status} ${res.statusText}`);
            return false;
        }
        console.log(`[reminder] Webhook sent for reminder ${reminder.id} → "${reminder.note_title}"`);
        return true;
    } catch (err) {
        console.error(`[reminder] Webhook error for ${reminder.id}:`, err);
        return false;
    }
}

async function checkReminders(): Promise<void> {
    const pending = getPendingReminders();
    if (pending.length === 0) return;

    console.log(`[reminder] Found ${pending.length} pending reminder(s)`);

    for (const reminder of pending) {
        const sent = await sendWebhook(reminder);
        if (sent) {
            markTriggered(reminder.id);
        }
    }
}

export function startReminderChecker(): void {
    console.log(`[reminder] Checker started, interval: ${INTERVAL_MS}ms, webhook: ${WEBHOOK_URL}`);
    checkReminders();
    setInterval(checkReminders, INTERVAL_MS);
}
