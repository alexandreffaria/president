/** An error caused by the request or the user's input; its message is safe to show. */
export class UserError extends Error {
  readonly status: 400 | 403 | 404 | 409 | 415 | 422;
  readonly code: string | undefined;
  readonly details: string[] | undefined;

  constructor(
    message: string,
    options: { status?: UserError["status"]; code?: string; details?: string[] } = {},
  ) {
    super(message);
    this.name = "UserError";
    this.status = options.status ?? 400;
    this.code = options.code;
    this.details = options.details;
  }
}
