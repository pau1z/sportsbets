const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const mysql = require('mysql2/promise');
const { createClient } = require('redis');
const cors = require('cors');
const winston = require('winston');
const { WebSocketHandler } = require('./websocket/websocketHandler');
const { ApiHandler } = require('./api/apiHandler');
const { CacheManager } = require('./cache/cacheManager');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const port = process.env.PORT || 3000;
const wsPort = process.env.WS_PORT || 3001;

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST || 'localhost',
  user: process.env.MYSQL_USER || 'sportsbet',
  password: process.env.MYSQL_PASSWORD || 'sportsbetpass',
  database: process.env.MYSQL_DATABASE || 'sportsbet',
  port: 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

const redis = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379'
});

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' })
  ]
});

const cacheManager = new CacheManager(redis, logger);
const apiHandler = new ApiHandler(pool, cacheManager, logger);
const wsHandler = new WebSocketHandler(io, pool, cacheManager, logger);

app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'healthy' });
});

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

app.get('/api/events', async (req, res) => {
  try {
    const events = await apiHandler.getEvents(req.query);
    res.json(events);
  } catch (error) {
    logger.error('Error fetching events:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/events/:id', async (req, res) => {
  try {
    const event = await apiHandler.getEventById(req.params.id);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }
    res.json(event);
  } catch (error) {
    logger.error('Error fetching event:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/odds/:eventId', async (req, res) => {
  try {
    const odds = await apiHandler.getEventOdds(req.params.eventId);
    res.json(odds);
  } catch (error) {
    logger.error('Error fetching odds:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

io.on('connection', (socket) => {
  wsConnections.inc();
  wsHandler.handleConnection(socket);

  socket.on('disconnect', () => {
    wsConnections.dec();
    wsHandler.handleDisconnection(socket);
  });
});

async function connectWithRetry(maxRetries = 5, delay = 5000) {
  let retries = 0;
  
  while (retries < maxRetries) {
    try {
      const connection = await pool.getConnection();
      connection.release();
      logger.info('Successfully connected to database');
      return;
    } catch (error) {
      retries++;
      logger.warn(`Database connection attempt ${retries} failed:`, error);
      
      if (retries === maxRetries) {
        throw error;
      }
      
      logger.info(`Retrying in ${delay/1000} seconds...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

async function start() {
  try {
    await connectWithRetry();
    await redis.connect();

    httpServer.listen(port, () => {
      logger.info(`Data distribution service listening on port ${port}`);
    });

    io.listen(wsPort, () => {
      logger.info(`WebSocket server listening on port ${wsPort}`);
    });
  } catch (error) {
    logger.error('Failed to start service:', error);
    process.exit(1);
  }
}

async function shutdown() {
  logger.info('Shutting down service...');

  try {
    await redis.quit();
    await pool.end();
    io.close();
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown:', error);
    process.exit(1);
  }
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

start(); 