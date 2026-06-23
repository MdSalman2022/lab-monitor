export class LabScheduleManagerError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "LabScheduleManagerError";
    this.code = code;
    this.status = status;
  }
}

export function notFound(message: string) {
  return new LabScheduleManagerError("NOT_FOUND", message, 404);
}

export function conflict(message: string) {
  return new LabScheduleManagerError("CONFLICT", message, 409);
}

export function validationError(message: string) {
  return new LabScheduleManagerError("VALIDATION_ERROR", message, 422);
}
