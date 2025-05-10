const express = require('express');
const { Kafka } = require('kafkajs');
const winston = require('winston');
const { XMLParser } = require('./parsers/xmlParser');
const { JSONParser } = require('./parsers/jsonParser');
const { FeedClient } = require('./clients/feedClient');

const app = express();
const port = process.env.PORT || 3000;

const kafka = new Kafka({
  clientId: 'feed-ingestion-service',
  brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(',')
});

const logger = winston.createLogger({
  level: 'debug',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          return `${timestamp} [${level}]: ${message} ${Object.keys(meta).length ? JSON.stringify(meta, null, 2) : ''}`;
        })
      )
    }),
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log', level: 'debug' })
  ]
});

const xmlParser = new XMLParser();
const jsonParser = new JSONParser();
const feedClient = new FeedClient();

const producer = kafka.producer();

app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'healthy' });
});

app.post('/ingest', async (req, res) => {
  const { feedUrl, feedType, feedData } = req.body;
  const startTime = Date.now();
  
  try {
    logger.debug('Received feed request:', {
      feedType,
      hasFeedUrl: !!feedUrl,
      hasFeedData: !!feedData
    });

    let data;

    if (feedData) {
      data = feedData;
    } else if (feedUrl) {
      data = await feedClient.fetchFeed(feedUrl);
    } else {
      throw new Error('Either feedUrl or feedData must be provided');
    }

    let parsedData;

    if (feedType === 'xml') {
      parsedData = await xmlParser.parse(data);
    } else if (feedType === 'json') {
      parsedData = await jsonParser.parse(data);
    } else {
      throw new Error(`Unsupported feed type: ${feedType}`);
    }

    if (!parsedData || !parsedData.events || !Array.isArray(parsedData.events)) {
      throw new Error('Invalid parsed data format: missing events array');
    }

    for (const event of parsedData.events) {
      if (!event.id) {
        throw new Error(`Event missing required ID field: ${JSON.stringify(event)}`);
      }
    }

    logger.debug('Parsed data:', JSON.stringify(parsedData, null, 2));

    const message = JSON.stringify(parsedData);

    logger.debug('Sending to Kafka:', {
      topic: 'sports-feed',
      messageLength: message.length,
      messagePreview: message.substring(0, 500) + '...'
    });

    await producer.send({
      topic: 'sports-feed',
      messages: [
        { value: message }
      ]
    });

    const duration = (Date.now() - startTime) / 1000;
    feedProcessingDuration.observe({ feed_type: feedType, status: 'success' }, duration);
    
    res.json({ 
      status: 'success', 
      message: 'Feed processed successfully',
      eventCount: parsedData.events.length,
      firstEventId: parsedData.events[0]?.id
    });
  } catch (error) {
    logger.error('Error processing feed:', {
      error: error.message,
      stack: error.stack,
      feedType,
      hasFeedUrl: !!feedUrl,
      hasFeedData: !!feedData
    });
    const duration = (Date.now() - startTime) / 1000;
    feedProcessingDuration.observe({ feed_type: feedType, status: 'error' }, duration);
    res.status(500).json({ status: 'error', message: error.message });
  }
});

async function start() {
  try {
    await producer.connect();
    
    app.listen(port, () => {
      logger.info(`Feed ingestion service listening on port ${port}`);
    });
  } catch (error) {
    logger.error('Failed to start service:', error);
    process.exit(1);
  }
}

start(); 