export class LabBeaconError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "LabBeaconError";
    this.code = code;
    this.status = status;
  }
}

export function notFound(message: string) {
  return new LabBeaconError("NOT_FOUND", message, 404);
}

export function conflict(message: string) {
  return new LabBeaconError("CONFLICT", message, 409);
}

export function validationError(message: string) {
  return new LabBeaconError("VALIDATION_ERROR", message, 422);
}
