import { fail, ok } from "@/server/http";
import { recordEvent } from "@/server/events";
import { sendTelegramMessage } from "@/server/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const event = recordEvent({
      type: "TELEGRAM_TEST",
      message: "LabBeacon Telegram test alert.",
    });
    const telegram = await sendTelegramMessage(event.message);
    return ok({ event, telegram });
  } catch (error) {
    return fail(error);
  }
}
