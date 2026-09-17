/**
 * Global error class for application errors with factories for common errors
 * @param {number} statusCode - The HTTP code error
 * @param {string} code - The error code in uppercase (e.g. 'INVALID_SESSION', 'RESOURCE_NOT_FOUND', ...)
 * @param {unknown | undefined} details - The error message with details to further comprehend the error (e.g. { reason: 'Données invalides' })
 * @extends Error
 */
export class AppError extends Error {
  statusCode: number
  code: string
  details?: unknown

  constructor(
    statusCode: number,
    code: string,
    message: string,
    details?: unknown,
  ) {
    super(message) // Inheritance from class Error
    this.statusCode = statusCode
    this.code = code
    this.details = details

    this.name = 'AppError'
  }

  // Factories for common errors

  // 404 - Not Found
  // Used when a resource can not be found or does not exist
  static notFound(code: string, message: string, details?: unknown): AppError {
    return new AppError(404, code, message, details)
  }

  // 400 - Bad Request
  // Used for schemas validation or for any misformatted requests
  static badRequest(
    code: string,
    message: string,
    details?: unknown,
  ): AppError {
    return new AppError(400, code, message, details)
  }

  // 401 - Unauthorized
  // Used when a resource can not be accessed without credentials (e.g. an user that is not authenticated yet or with an expired session)
  static unauthorized(
    code: string,
    message: string,
    details?: unknown,
  ): AppError {
    return new AppError(401, code, message, details)
  }

  // 409 - Conflict
  // Used when data collides (e.g. already existing resource, duplicates, ...)
  static conflict(code: string, message: string, details?: unknown): AppError {
    return new AppError(409, code, message, details)
  }

  // 503 - Service Unavailable
  // Used when a dependency is down (e.g. Ollama)
  static serviceUnavailable(
    code: string,
    message: string,
    details?: unknown,
  ): AppError {
    return new AppError(503, code, message, details)
  }
}
