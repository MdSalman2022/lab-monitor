import { appConfig, type AppConfig } from "./config";

export type TelegramResult =
  | { sent: true; dryRun: false }
  | { sent: false; dryRun: true; reason: string }
  | { sent: false; dryRun: false; reason: string };

export async function sendTelegramMessage(
  text: string,
  config: AppConfig = appConfig,
): Promise<TelegramResult> {
  if (config.telegramDryRun) {
    return { sent: false, dryRun: true, reason: "TELEGRAM_DRY_RUN is enabled" };
  }

  if (!config.telegramBotToken || !config.telegramChatId) {
    return {
      sent: false,
      dryRun: false,
      reason: "Telegram token or chat id is missing",
    };
  }

  const response = await fetch(
    `https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: config.telegramChatId,
        text,
        disable_web_page_preview: true,
      }),
    },
  );

  if (!response.ok) {
    return {
      sent: false,
      dryRun: false,
      reason: `Telegram API returned ${response.status}`,
    };
  }

  return { sent: true, dryRun: false };
}
