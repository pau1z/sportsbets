const winston = require('winston');

class DataProcessor {

  constructor(pool, redis, logger) {
    this.pool = pool;
    this.redis = redis;
    this.logger = logger;
    this.CACHE_TTL = 3600; // 1 hour in seconds
  }

  async processData(data, sport) {
    this.logger.debug('Processing batch:', {
      sport,
      eventCount: data.events?.length || 0,
      batchTimestamp: data.headers?.['batch-timestamp']
    });

    if (!data?.events?.length) {
      this.logger.error('Invalid data format:', data);
      return;
    }

    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();

      for (const event of data.events) {
        if (!event.id) {
          this.logger.error('Skipping event with missing ID:', event);
          continue;
        }

        try {
          this.logger.debug('Processing event:', {
            eventId: event.id,
            sport,
            eventType: typeof event,
            eventKeys: Object.keys(event)
          });

          if (event.sport.toLowerCase() !== sport) {
            this.logger.warn('Event sport mismatch:', {
              eventSport: event.sport,
              topicSport: sport,
              eventId: event.id
            });
            continue;
          }

          this.validateData(event);

          await this.processEvent(connection, event);

          if (event.participants?.length) {
            await this.processParticipants(connection, event.id, event.participants);
          }

          if (event.odds?.length) {
            await this.processOdds(connection, event.id, event.odds);
          }

          await this.cacheEventData(event);
        } catch (error) {
          this.logger.error('Error processing event:', { 
            event, 
            error: error.message,
            sport
          });
          continue;
        }
      }

      await connection.commit();
    } catch (error) {
      await connection.rollback();
      this.logger.error('Error processing batch:', {
        error: error.message,
        stack: error.stack,
        sport,
        batchTimestamp: data.headers?.['batch-timestamp']
      });
      throw error;
    } finally {
      connection.release();
    }
  }

  async cacheEventData(event) {
    try {
      const eventKey = `event:${event.id}`;
      const eventData = {
        id: event.id,
        sport: event.sport,
        competition: event.competition,
        startTime: event.startTime || event.start_time,
        status: event.status,
        participants: event.participants || [],
        odds: event.odds || [],
        lastUpdated: Date.now()
      };

      // Cache the event data with TTL
      await this.redis.set(eventKey, JSON.stringify(eventData), {
        EX: this.CACHE_TTL
      });

      // Add to sport index with TTL
      const sportKey = `sport:${event.sport.toLowerCase()}:events`;
      await this.redis.sAdd(sportKey, event.id);
      await this.redis.expire(sportKey, this.CACHE_TTL);

      // Add to competition index with TTL
      const competitionKey = `competition:${event.competition.toLowerCase()}:events`;
      await this.redis.sAdd(competitionKey, event.id);
      await this.redis.expire(competitionKey, this.CACHE_TTL);

      this.logger.debug('Cached event data:', {
        eventId: event.id,
        sport: event.sport,
        competition: event.competition,
        sportKey,
        competitionKey,
        ttl: this.CACHE_TTL
      });
    } catch (error) {
      this.logger.error('Error caching event data:', {
        eventId: event.id,
        error: error.message
      });
    }
  }

  async processEvent(connection, event) {
    const eventId = event.id;

    this.logger.debug('Processing event with ID:', {
      eventId,
      hasId: !!eventId,
      eventType: typeof event,
      eventKeys: Object.keys(event)
    });

    if (!eventId) {
      this.logger.error('Event missing ID:', JSON.stringify(event, null, 2));
      throw new Error('Event ID is required');
    }

    const params = [
      eventId,
      event.sport || 'UNKNOWN',
      event.competition || 'UNKNOWN',
      new Date(event.startTime || event.start_time || Date.now()).toISOString().slice(0, 19).replace('T', ' '),
      event.status || 'UNKNOWN'
    ];

    this.logger.debug('Executing SQL with params:', params);

    const [result] = await connection.execute(
      `INSERT INTO events (id, sport, competition, start_time, status)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         sport = COALESCE(VALUES(sport), sport),
         competition = COALESCE(VALUES(competition), competition),
         start_time = COALESCE(VALUES(start_time), start_time),
         status = COALESCE(VALUES(status), status)`,
      params
    );
  }

  async processParticipants(connection, eventId, participants) {
    if (!eventId) {
      throw new Error('Event ID is required for processing participants');
    }

    await connection.execute(
      'DELETE FROM participants WHERE event_id = ?',
      [eventId]
    );

    for (const participant of participants) {
      if (!participant.name) {
        this.logger.warn('Skipping participant with missing name');
        continue;
      }

      await connection.execute(
        `INSERT INTO participants (id, event_id, name, type)
         VALUES (UUID(), ?, ?, ?)`,
        [
          eventId,
          participant.name,
          participant.type || 'UNKNOWN'
        ]
      );
    }
  }

  async processOdds(connection, eventId, odds) {
    if (!eventId) {
      throw new Error('Event ID is required for processing odds');
    }

    for (const odd of odds) {
      if (!odd.market_type || !odd.selection || !odd.price) {
        this.logger.warn('Skipping invalid odds entry:', odd);
        continue;
      }

      await connection.execute(
        `INSERT INTO odds (id, event_id, market_type, selection, price)
         VALUES (UUID(), ?, ?, ?, ?)`,
        [
          eventId,
          odd.market_type,
          odd.selection,
          parseFloat(odd.price) || 0
        ]
      );
    }
  }

  validateData(data) {
    this.logger.debug('Validating data:', JSON.stringify(data, null, 2));

    if (!data) {
      throw new Error('No data provided');
    }

    if (!data.id) {
      this.logger.error('Event missing ID:', JSON.stringify(data, null, 2));
      throw new Error('Event ID is required');
    }

    if (!data.sport) {
      throw new Error('Sport is required');
    }

    if (!data.competition) {
      throw new Error('Competition is required');
    }

    if (!data.startTime && !data.start_time) {
      throw new Error('Start time is required');
    }

    if (!data.status) {
      throw new Error('Status is required');
    }

    if (data.participants && !Array.isArray(data.participants)) {
      throw new Error('Participants must be an array');
    }

    if (data.odds && !Array.isArray(data.odds)) {
      throw new Error('Odds must be an array');
    }
  }
}

module.exports = { DataProcessor }; 