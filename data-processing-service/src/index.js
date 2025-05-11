const express = require('express');
const { Kafka } = require('kafkajs');
const mysql = require('mysql2/promise');
const winston = require('winston');
const Redis = require('ioredis');
const { DataProcessor } = require('./processors/dataProcessor');

const app = express();
const port = process.env.PORT || 3000;

// Initialize Kafka
const kafka = new Kafka({
  clientId: `data-processing-${process.env.SPORT_TYPE}`,
  brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(',')
});

const consumer = kafka.consumer({ groupId: `data-processing-${process.env.SPORT_TYPE}` });

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST || 'localhost',
  user: process.env.MYSQL_USER || 'sportsbet',
  password: process.env.MYSQL_PASSWORD || 'sportsbetpass',
  database: process.env.MYSQL_DATABASE || 'sportsbet',
  port: process.env.MYSQL_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Initialize Redis with automatic connection
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  retryStrategy: (times) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  }
});

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'debug',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  defaultMeta: { service: `data-processing-${process.env.SPORT_TYPE}` },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    }),
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' })
  ]
});

const dataProcessor = new DataProcessor(pool, redis, logger);

app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'healthy' });
});

async function connectWithRetry(maxRetries = 5, delay = 5000) {
  let retries = 0;

  while (retries < maxRetries) {
    try {
      const connection = await pool.getConnection();
      connection.release();
      logger.info('Successfully connected to database');

      // Test Redis connection
      await redis.ping();
      logger.info('Successfully connected to Redis');

      return;
    } catch (error) {
      retries++;
      logger.warn(`Connection attempt ${retries} failed:`, error);
      
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
    await consumer.connect();
    logger.info('Connected to Kafka');

    const SPORT_TYPE = process.env.SPORT_TYPE;
    const KAFKA_TOPIC = process.env.KAFKA_TOPIC;

    if (!SPORT_TYPE || !KAFKA_TOPIC) {
      logger.error('SPORT_TYPE and KAFKA_TOPIC environment variables are required');
      process.exit(1);
    }

    await consumer.subscribe({ topic: KAFKA_TOPIC, fromBeginning: true });
    logger.info(`Subscribed to topic: ${KAFKA_TOPIC}`);

    await consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        const startTime = Date.now();
        try {
          logger.debug('Received message:', {
            topic,
            partition,
            value: message.value.toString()
          });

          let value;
          try {
            value = JSON.parse(message.value.toString());
            logger.debug('Parsed message:', {
              hasValue: !!value,
              valueType: typeof value,
              hasEvents: !!(value && value.events),
              eventsType: value?.events ? typeof value.events : 'none',
              isArray: !!(value?.events && Array.isArray(value.events)),
              eventCount: value?.events?.length || 0,
              firstEventId: value?.events?.[0]?.id,
              topic
            });
          } catch (parseError) {
            logger.error('Failed to parse message:', {
              error: parseError.message,
              message: message.value.toString(),
              topic
            });
            throw new Error(`Invalid JSON message: ${parseError.message}`);
          }

          if (!value || typeof value !== 'object') {
            throw new Error('Invalid message format: expected object');
          }

          if (!value.events || !Array.isArray(value.events)) {
            throw new Error('Invalid message format: missing events array');
          }

          const sport = topic.replace('sports-feed-', '');
          await dataProcessor.processData(value, sport);

        } catch (error) {
          logger.error('Error processing message:', {
            error: error.message,
            stack: error.stack,
            topic,
            partition,
            message: message.value.toString()
          });
        }
      }
    });

    app.listen(port, () => {
      logger.info(`Data processing service listening on port ${port}`);
    });
  } catch (error) {
    logger.error('Failed to start service:', error);
    process.exit(1);
  }
}

async function shutdown() {
  logger.info('Shutting down service...');

  try {
    await consumer.disconnect();
    await pool.end();
    await redis.quit();
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown:', error);
    process.exit(1);
  }
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

start(); 