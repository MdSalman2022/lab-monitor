import { userUpdateSchema } from "@/server/api-schemas";
import { fail, ok } from "@/server/http";
import { listUsers, updateUser } from "@/server/sessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  try {
    return ok({ users: listUsers() });
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const input = userUpdateSchema.parse(await request.json());
    const { id, ...changes } = input;
    return ok({ user: updateUser(id, changes) });
  } catch (error) {
    return fail(error);
  }
}
