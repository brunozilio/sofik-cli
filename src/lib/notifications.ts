import { execSync } from "child_process";

/**
 * Send a native OS notification.
 * Best-effort: silently ignores errors if notification tooling is unavailable.
 */
export function sendNotification(title: string, body: string): void {
  try {
    if (process.platform === "darwin") {
      const safeTitle = title.replace(/'/g, "\\'");
      const safeBody = body.replace(/'/g, "\\'");
      execSync(`osascript -e 'display notification "${safeBody}" with title "${safeTitle}"'`, {
        stdio: "ignore",
        timeout: 3000,
      });
    } else if (process.platform === "linux") {
      const safeTitle = title.replace(/"/g, '\\"');
      const safeBody = body.replace(/"/g, '\\"');
      execSync(`notify-send "${safeTitle}" "${safeBody}"`, {
        stdio: "ignore",
        timeout: 3000,
      });
    }
  } catch { /* ignore — notification is best-effort */ }
}
