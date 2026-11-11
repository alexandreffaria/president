/**
 * An expected failure: a bad request, bad input, or a problem with the user's setup (an
 * invalid config file, a folder president may not write to). Its message is safe to show
 * and explains what to do; the API returns it with `status`, the CLI prints it.
 */
export class UserError extends Error {
  readonly status: 400 | 403 | 404 | 409 | 413 | 415 | 422 | 500;
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

/** A user-facing message for a file system error (permission denied, read-only, a link loop, ...). */
export function fileError(action: string, path: string, error: unknown): UserError | unknown {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  const reason =
    code === "EACCES" || code === "EPERM"
      ? "permission denied"
      : code === "EROFS"
        ? "the file system is read-only"
        : code === "ENOSPC"
          ? "the disk is full"
          : code === "ENOTDIR"
            ? "a part of the path is a file, not a folder"
            : code === "ELOOP"
              ? "the path goes through a loop of links"
              : undefined;
  return reason ? new UserError(`cannot ${action} ${path}: ${reason}`, { status: 422 }) : error;
}
