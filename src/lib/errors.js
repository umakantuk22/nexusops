/**
 * Project Nexus - Standardized Error Hierarchy
 */
export class AppError extends Error {
  constructor(message, code, statusCode = 500, details = null) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON(requestId = null) {
    const errorPayload = {
      code: this.code,
      message: this.message,
    };
    if (requestId) {
      errorPayload.requestId = requestId;
    }
    if (this.details) {
      errorPayload.details = this.details;
    }
    return { error: errorPayload };
  }
}

export class ValidationError extends AppError {
  constructor(message, details = null) {
    super(message, 'VALIDATION_ERROR', 400, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required.') {
    super(message, 'UNAUTHORIZED', 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Access denied. Insufficient permissions.') {
    super(message, 'FORBIDDEN', 403);
  }
}

export class NotFoundError extends AppError {
  constructor(entityName = 'Resource') {
    super(`${entityName} not found.`, `${entityName.toUpperCase().replace(/\s+/g, '_')}_NOT_FOUND`, 404);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Resource already exists.') {
    super(message, 'CONFLICT', 409);
  }
}

export class TenantIsolationError extends AppError {
  constructor(message = 'Cross-tenant access violation detected.') {
    super(message, 'TENANT_ISOLATION_VIOLATION', 403);
  }
}

export class ConcurrencyError extends AppError {
  constructor(message = 'Concurrent modification detected. Please refresh and retry.') {
    super(message, 'CONCURRENCY_CONFLICT', 409);
  }
}

export function formatErrorResponse(err, requestId = null) {
  if (err instanceof AppError) {
    return {
      statusCode: err.statusCode,
      body: err.toJSON(requestId),
    };
  }

  // Hide internal implementation details from end users
  return {
    statusCode: 500,
    body: {
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected error occurred. Please contact support.',
        ...(requestId ? { requestId } : {}),
      },
    },
  };
}
