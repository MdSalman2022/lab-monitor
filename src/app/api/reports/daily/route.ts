import { fail, ok } from "@/server/http";
import { listSessionsForDay } from "@/server/sessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const date = url.searchParams.get("date") ?? todayKey();
    return ok({ date, sessions: listSessionsForDay(date) });
  } catch (error) {
    return fail(error);
  }
}
