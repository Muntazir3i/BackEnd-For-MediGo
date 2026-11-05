/**
 * Small error helper so controllers can translate domain failures into the
 * right HTTP status without exposing internal details.
 */
export function httpError(statusCode, message, details = null) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (details) error.details = details;
  return error;
}

export function validationError(message, details = null) {
  return httpError(400, message, details);
}

export function notFoundError(message = 'Record not found') {
  return httpError(404, message);
}

export function conflictError(message, details = null) {
  return httpError(409, message, details);
}
