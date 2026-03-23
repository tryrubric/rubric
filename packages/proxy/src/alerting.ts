import { getAlertConfig, getWindowAvgQuality, recordAlertEvent } from "./db.js";

export async function checkDriftAndAlert(apiKeyId: string): Promise<void> {
  const config = getAlertConfig(apiKeyId);
  if (!config || !config.webhook_url) return;

  const windowMs = config.window_hours * 3600 * 1000;
  const now = Date.now();

  const scoreCurrent = getWindowAvgQuality(apiKeyId, now - windowMs, now);
  const scorePrevious = getWindowAvgQuality(apiKeyId, now - 2 * windowMs, now - windowMs);

  // Need at least 5 traces in current window to make a meaningful comparison
  if (scoreCurrent === null || scorePrevious === null) return;

  const drop = (scorePrevious - scoreCurrent) / scorePrevious;

  if (drop >= config.threshold) {
    const message =
      `[AI Quality Guard] Quality drift detected!\n` +
      `Previous ${config.window_hours}h avg: ${(scorePrevious * 100).toFixed(1)}%\n` +
      `Current ${config.window_hours}h avg:  ${(scoreCurrent * 100).toFixed(1)}%\n` +
      `Drop: ${(drop * 100).toFixed(1)}% (threshold: ${(config.threshold * 100).toFixed(0)}%)`;

    recordAlertEvent(apiKeyId, "quality_drift", message, scoreCurrent, scorePrevious);
    await sendWebhook(config.webhook_url, message, scoreCurrent, scorePrevious);
  }
}

async function sendWebhook(
  url: string,
  message: string,
  scoreNow: number,
  scoreBefore: number
): Promise<void> {
  try {
    // Slack-compatible payload (also works as generic JSON webhook)
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: message,
        attachments: [
          {
            color: "danger",
            fields: [
              { title: "Current Score", value: `${(scoreNow * 100).toFixed(1)}%`, short: true },
              { title: "Previous Score", value: `${(scoreBefore * 100).toFixed(1)}%`, short: true },
            ],
          },
        ],
      }),
    });
  } catch {
    // Non-fatal
  }
}
