const express = require('express');
const { Kafka } = require('kafkajs');
const winston = require('winston');
const { XMLParser } = require('./parsers/xmlParser');
const { JSONParser } = require('./parsers/jsonParser');
const { FeedClient } = require('./clients/feedClient');

const app = express();
const port = process.env.PORT || 3000;

const SUPPORTED_SPORTS = (process.env.SUPPORTED_SPORTS || 'football,basketball,tennis,hockey').split(',');
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '100', 10);
const DEAD_LETTER_TOPIC = 'sports-feed-dead-letter';

const kafka = new Kafka({
  clientId: 'feed-ingestion-service',
  brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
  createTopics: {
    topics: [
      { topic: 'sports-feed-football', numPartitions: 1, replicationFactor: 1 },
      { topic: 'sports-feed-basketball', numPartitions: 1, replicationFactor: 1 },
      { topic: 'sports-feed-tennis', numPartitions: 1, replicationFactor: 1 },
      { topic: 'sports-feed-hockey', numPartitions: 1, replicationFactor: 1 },
      { topic: 'sports-feed-dead-letter', numPartitions: 1, replicationFactor: 1 }
    ]
  }
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

    let data = feedData || (feedUrl ? await feedClient.fetchFeed(feedUrl) : null);
    if (!data) {
      throw new Error('Either feedUrl or feedData must be provided');
    }

    let parsedData = feedType === 'xml' ? 
      await xmlParser.parse(data) : 
      feedType === 'json' ? 
        await jsonParser.parse(data) : 
        null;

    if (!parsedData?.events?.length) {
      throw new Error('Invalid parsed data format: missing events array');
    }

    const results = {
      processed: 0,
      invalid: 0,
      bySport: {}
    };

    for (let i = 0; i < parsedData.events.length; i += BATCH_SIZE) {
      const batch = parsedData.events.slice(i, i + BATCH_SIZE);
      const batchResults = await processEventBatch(batch);
      
      results.processed += batchResults.processed;
      results.invalid += batchResults.invalid;
      Object.entries(batchResults.bySport).forEach(([sport, count]) => {
        results.bySport[sport] = (results.bySport[sport] || 0) + count;
      });
    }

    res.json({ 
      status: 'success', 
      message: 'Feed processed successfully',
      results
    });
  } catch (error) {
    logger.error('Error processing feed:', {
      error: error.message,
      stack: error.stack,
      feedType,
      hasFeedUrl: !!feedUrl,
      hasFeedData: !!feedData
    });

    res.status(500).json({ status: 'error', message: error.message });
  }
});

async function processEventBatch(events) {
  const results = {
    processed: 0,
    invalid: 0,
    bySport: {}
  };

  const validEvents = [];
  const invalidEvents = [];

  for (const event of events) {
    if (!event.id || !event.sport) {
      invalidEvents.push(event);
      continue;
    }

    const sport = event.sport.toLowerCase().replace(/\s+/g, '-');

    if (!SUPPORTED_SPORTS.includes(sport)) {
      invalidEvents.push(event);
      continue;
    }

    validEvents.push({ ...event, sport });
    results.bySport[sport] = (results.bySport[sport] || 0) + 1;
  }

  // Send valid events to sport-specific topics
  const sendPromises = Object.entries(
    validEvents.reduce((acc, event) => {
      if (!acc[event.sport]) acc[event.sport] = [];
      acc[event.sport].push(event);
      return acc;
    }, {})
  ).map(async ([sport, events]) => {
    const topic = `sports-feed-${sport}`;
    await producer.send({
      topic,
      messages: [{ 
        value: JSON.stringify({ events }),
        headers: {
          'event-count': events.length.toString(),
          'batch-timestamp': Date.now().toString()
        }
      }]
    });
    results.processed += events.length;
  });

  // Send invalid events to dead letter queue
  if (invalidEvents.length > 0) {
    await producer.send({
      topic: DEAD_LETTER_TOPIC,
      messages: [{
        value: JSON.stringify({ 
          events: invalidEvents,
          reason: 'Invalid event format or unsupported sport'
        })
      }]
    });
    results.invalid = invalidEvents.length;
  }

  await Promise.all(sendPromises);
  return results;
}

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