export class HttpError extends Error {
  readonly statusCode: number;
  readonly errorCode: string;
  readonly details?: unknown;

  constructor(statusCode: number, errorCode: string, message: string, details?: unknown) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.details = details;
  }
}
