export class AppError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message = "Authentication required.") {
    super("unauthenticated", message, 401);
    this.name = "UnauthenticatedError";
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You do not have permission to perform this action.") {
    super("forbidden", message, 403);
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends AppError {
  constructor(message = "The requested resource was not found.") {
    super("not_found", message, 404);
    this.name = "NotFoundError";
  }
}

export class ValidationError extends AppError {
  constructor(
    message = "Please check the submitted values and try again.",
    readonly fieldErrors?: Record<string, string[]>,
  ) {
    super("validation_error", message, 422);
    this.name = "ValidationError";
  }
}

export class ConflictError extends AppError {
  constructor(message = "That change conflicts with the current state.") {
    super("conflict", message, 409);
    this.name = "ConflictError";
  }
}

export class RateLimitedError extends AppError {
  constructor(readonly retryAfterSeconds: number) {
    super(
      "rate_limited",
      "Too many attempts. Please wait a few minutes and try again.",
      429,
    );
    this.name = "RateLimitedError";
  }
}

export class InvalidCredentialsError extends AppError {
  constructor() {
    super("invalid_credentials", "Invalid email or password.", 401);
    this.name = "InvalidCredentialsError";
  }
}

export function safeErrorMessage(
  error: unknown,
  fallback = "Something went wrong. Please try again.",
): string {
  if (error instanceof AppError) {
    return error.message;
  }
  return fallback;
}
