const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { NODE_ENV, CORS_ORIGINS } = require('./config/env');
const errorHandler = require('./middleware/errorHandler');
const cookieParser = require('./middleware/cookieParser');
const rateLimit = require('./middleware/rateLimit');

const authRoutes = require('./routes/auth');
const inspectionRoutes = require('./routes/inspections');
const productRoutes = require('./routes/products');
const reportRoutes = require('./routes/reports');
const dashboardRoutes = require('./routes/dashboard');
const ruleRoutes = require('./routes/rules');
const userRoutes = require('./routes/users');
const ocrRoutes = require('./routes/ocr');

/**
 * Builds the Express application. Kept separate from server.js so tests can
 * mount the API without opening a port or connecting to a real database.
 */
function createApp() {
  const app = express();

  // Behind a reverse proxy, req.ip must reflect the real client for rate limiting.
  app.set('trust proxy', 1);

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

  // Credentials are required so the browser sends the httpOnly refresh cookie.
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || CORS_ORIGINS.includes(origin)) return callback(null, true);
        return callback(new Error(`Origin ${origin} is not allowed by CORS policy`));
      },
      credentials: true,
      exposedHeaders: ['X-RateLimit-Remaining', 'X-RateLimit-Reset', 'Retry-After']
    })
  );

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(cookieParser);

  // Broad ceiling on the whole API; the auth routes add their own tighter limits.
  app.use('/api', rateLimit({ windowMs: 60 * 1000, max: 300, keyPrefix: 'api' }));

  if (NODE_ENV === 'development') {
    app.use(morgan('dev'));
  }

  app.get('/api/health', (req, res) => {
    res.status(200).json({
      success: true,
      data: {
        status: 'ok',
        env: NODE_ENV,
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
      }
    });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/inspections', inspectionRoutes);
  app.use('/api/products', productRoutes);
  app.use('/api/reports', reportRoutes);
  app.use('/api/dashboard', dashboardRoutes);
  app.use('/api/rules', ruleRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/ocr', ocrRoutes);

  app.use((req, res) => {
    res.status(404).json({
      success: false,
      error: { message: `Route ${req.method} ${req.originalUrl} not found`, code: 404 }
    });
  });

  app.use(errorHandler);

  return app;
}

module.exports = createApp;
