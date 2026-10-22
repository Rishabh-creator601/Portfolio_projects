const errorHandler = (err, req, res, next) => {
  console.error(err);

  let error = { ...err };
  error.message = err.message;

  // Mongoose bad ObjectId
  if (err.name === 'CastError') {
    const message = `Resource not found`;
    error = { message, code: 404 };
  }

  // Mongoose duplicate key
  if (err.code === 11000) {
    const message = 'Duplicate field value entered';
    error = { message, code: 400 };
  }

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const message = Object.values(err.errors).map(val => val.message).join(', ');
    error = { message, code: 400 };
  }

  // Zod validation error
  if (err.name === 'ZodError') {
    const message = err.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
    error = { message, code: 400, details: err.errors };
  }
  
  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    error = { message: 'Invalid token', code: 401 };
  }
  if (err.name === 'TokenExpiredError') {
    error = { message: 'Token expired', code: 401 };
  }

  // Multer errors
  if (err.name === 'MulterError') {
    error = { message: err.message, code: 400 };
  }

  const statusCode = error.code && error.code >= 400 && error.code < 600 ? error.code : res.statusCode === 200 ? 500 : res.statusCode;

  res.status(statusCode || 500).json({
    success: false,
    error: {
      message: error.message || 'Server Error',
      code: statusCode || 500,
      details: error.details || null
    }
  });
};

module.exports = errorHandler;
