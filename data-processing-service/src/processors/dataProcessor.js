const winston = require('winston');

class DataProcessor {

  constructor(pool, redis, logger) {
    this.pool = pool;
    this.redis = redis;
    this.logger = logger;
  }

  async processData(data) {
    this.logger.debug('Received data:', {
      hasData: !!data,
      dataType: typeof data,
      hasEvents: !!(data && data.events),
      eventsType: data?.events ? typeof data.events : 'none',
      isArray: !!(data?.events && Array.isArray(data.events)),
      eventCount: data?.events?.length || 0,
      firstEventId: data?.events?.[0]?.id
    });

    if (!data || !data.events || !Array.isArray(data.events)) {
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
            hasId: !!event.id,
            eventType: typeof event,
            eventKeys: Object.keys(event)
          });

          this.validateData(event);

          await this.processEvent(connection, event);

          if (event.participants && Array.isArray(event.participants)) {
            await this.processParticipants(connection, event.id, event.participants);
          }

          if (event.odds && Array.isArray(event.odds)) {
            await this.processOdds(connection, event.id, event.odds);
          }

          // Cache the processed event data
          await this.cacheEventData(event);
        } catch (error) {
          this.logger.error('Error processing event:', { event, error: error.message });
          continue;
        }
      }

      await connection.commit();
    } catch (error) {
      await connection.rollback();
      this.logger.error('Error processing data:', {
        error: error.message,
        stack: error.stack,
        data: JSON.stringify(data, null, 2)
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
        odds: event.odds || []
      };

      // Cache the event data with a 1-hour expiration
      await this.redis.set(eventKey, JSON.stringify(eventData), {
        EX: 3600 // 1 hour in seconds
      });

      // Add to sport index
      await this.redis.sAdd(`sport:${event.sport}:events`, event.id);

      // Add to competition index
      await this.redis.sAdd(`competition:${event.competition}:events`, event.id);

      this.logger.debug('Cached event data:', {
        eventId: event.id,
        sport: event.sport,
        competition: event.competition
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