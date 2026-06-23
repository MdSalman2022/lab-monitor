import { userIdSchema } from "@/server/api-schemas";
import { fail, ok } from "@/server/http";
import { claimSession } from "@/server/sessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const input = userIdSchema.parse(await request.json());
    return ok({ session: claimSession(input.userId) }, 201);
  } catch (error) {
    return fail(error);
  }
}
