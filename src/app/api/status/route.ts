import { getDashboardStatus } from "@/server/status";
import { fail, ok } from "@/server/http";
import { sampleGpuNow, sampleGpuProcessesNow } from "@/server/gpu";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await sampleGpuNow().catch(() => null);
    await sampleGpuProcessesNow().catch(() => null);
    return ok(getDashboardStatus());
  } catch (error) {
    return fail(error);
  }
}
