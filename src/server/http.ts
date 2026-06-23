import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { LabScheduleManagerError } from "./errors";

export function ok<T>(data: T, status = 200) {
  return NextResponse.json(data, { status });
}

export function fail(error: unknown) {
  if (error instanceof LabScheduleManagerError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      { status: error.status },
    );
  }

  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid request payload",
          details: error.flatten(),
        },
      },
      { status: 422 },
    );
  }

  return NextResponse.json(
    {
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "Lab Schedule Manager hit an unexpected error",
      },
    },
    { status: 500 },
  );
}
