import { sessionIdSchema } from "@/server/api-schemas";
import { fail, ok } from "@/server/http";
import { endSession } from "@/server/sessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const input = sessionIdSchema.parse(await request.json());
    return ok({ session: endSession(input.sessionId) });
  } catch (error) {
    return fail(error);
  }
}
