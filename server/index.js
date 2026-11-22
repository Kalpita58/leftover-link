import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import helmet from 'helmet';
import mongoose from 'mongoose';
import { config } from './config.js';
import authRoutes from './routes/auth.js';
import offerRoutes from './routes/offers.js';
import adminRoutes from './routes/admin.js';
import aiRoutes from './routes/ai.js';
import { sameOriginOnly } from './middleware/security.js';

const app = express();
const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..');

if (config.trustProxy) app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"], scriptSrc: ["'self'", "'unsafe-inline'"], styleSrc: ["'self'", "'unsafe-inline'"],
      connectSrc: ["'self'"], imgSrc: ["'self'", 'data:'], fontSrc: ["'self'"], objectSrc: ["'none'"],
      baseUri: ["'self'"], formAction: ["'self'"], frameAncestors: ["'none'"], upgradeInsecureRequests: null
    }
  }
}));
app.use(express.json({ limit: '32kb', type: 'application/json' }));
app.use('/api', sameOriginOnly);
app.use(session({
  name: 'leftover.sid',
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  store: MongoStore.create({ mongoUrl: config.mongoUri, collectionName: 'sessions', ttl: 60 * 60 * 24 * 30 }),
  cookie: {
    httpOnly: true,
    secure: config.nodeEnv === 'production',
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 8,
    path: '/'
  }
}));

app.get('/api/health', (_req, res) => {
  const connected = mongoose.connection.readyState === 1;
  res.status(connected ? 200 : 503).json({ status: connected ? 'ok' : 'database_unavailable' });
});
app.use('/api/auth', authRoutes);
app.use('/api/offers', offerRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/ai', aiRoutes);

for (const page of ['index.html', 'login.html', 'dashboard.html']) {
  app.get(page === 'index.html' ? ['/', '/index.html'] : `/${page}`, (_req, res) => res.sendFile(path.join(projectRoot, page)));
}

app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found.' }));
app.use((_req, res) => res.status(404).send('Page not found.'));
app.use((error, _req, res, _next) => {
  if (error?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Request body is not valid JSON.' });
  if (error?.name === 'ValidationError') return res.status(400).json({ error: 'The submitted information is not valid.' });
  if (error?.name === 'CastError') return res.status(400).json({ error: 'Invalid record id.' });
  console.error('Request error:', error);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

let server;
try {
  await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 10000 });
  server = app.listen(config.port, () => console.log(`Leftover Link is ready on http://localhost:${config.port}`));
} catch (error) {
  console.error('Could not connect to MongoDB. Check MONGODB_URI and Atlas network access.', error.message);
  process.exitCode = 1;
}

async function shutdown(signal) {
  console.log(`${signal} received. Closing server.`);
  if (server) await new Promise(resolve => server.close(resolve));
  await mongoose.disconnect();
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
