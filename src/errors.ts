/**
 * The server answered with `success: false`.
 *
 * Branch on `errorCode`, not on the message, which may change. Unrecognized
 * codes land here directly.
 */
export class ApiError extends Error {
  override name = "ApiError";

  /** Value of `error.code`; empty if the server sent none. */
  readonly errorCode: string;

  /** HTTP status code. */
  readonly status: number;

  /**
   * Value of `error.details`: an array for `PARAM_NOT_FOUND`, an object with
   * keys like `query.age` for `VALIDATION_ERROR`.
   */
  readonly details: unknown;

  constructor(message = "", errorCode = "", status = 0, details: unknown = null) {
    super(message);
    this.errorCode = errorCode;
    this.status = status;
    this.details = details;
  }
}

/** NOT_FOUND: the service or the API version does not exist. */
export class ServiceNotFoundError extends ApiError {
  override name = "ServiceNotFoundError";
}

/** PARAM_NOT_FOUND or VALIDATION_ERROR: the server rejected the parameters. */
export class ValidationError extends ApiError {
  override name = "ValidationError";
}

/** RATE_LIMITED or RATE_LIMIT_EXCEEDED. */
export class RateLimitError extends ApiError {
  override name = "RateLimitError";
}

/** Any other error code with an HTTP status of 500 or above. */
export class ServerError extends ApiError {
  override name = "ServerError";
}

/**
 * No usable API answer arrived.
 *
 * Raised for a network failure, a timeout, an unreadable or non-JSON body, or a
 * body that does not follow the API format. Deliberately not an {@link ApiError}.
 * The original error, if any, is in `cause`.
 */
export class TransportError extends Error {
  override name = "TransportError";

  constructor(message = "", options?: ErrorOptions) {
    super(message, options);
  }
}
