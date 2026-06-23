import {
  scheduleCreateSchema,
  scheduleDeleteSchema,
  scheduleUpdateSchema,
} from "@/server/api-schemas";
import { fail, ok } from "@/server/http";
import {
  createScheduleSlot,
  deleteScheduleSlot,
  listScheduleSlots,
  updateScheduleSlot,
} from "@/server/schedule";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  try {
    return ok({ slots: listScheduleSlots() });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const input = scheduleCreateSchema.parse(await request.json());
    return ok({ slot: createScheduleSlot(input) }, 201);
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const input = scheduleUpdateSchema.parse(await request.json());
    const { id, ...changes } = input;
    return ok({ slot: updateScheduleSlot(id, changes) });
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const input = scheduleDeleteSchema.parse(await request.json());
    deleteScheduleSlot(input.id);
    return ok({ deleted: true });
  } catch (error) {
    return fail(error);
  }
}
