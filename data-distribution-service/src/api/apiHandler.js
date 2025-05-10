class ApiHandler {

  constructor(pool, cacheManager, logger) {
    this.pool = pool;
    this.cacheManager = cacheManager;
    this.logger = logger;
  }

  async getEvents(queryParams = {}) {
    try {
      const { sport, competition, status, startTime, endTime } = queryParams;
      const conditions = [];
      const params = [];

      if (sport) {
        conditions.push(`sport = ?`);
        params.push(sport);
      }

      if (competition) {
        conditions.push(`competition = ?`);
        params.push(competition);
      }

      if (status) {
        conditions.push(`status = ?`);
        params.push(status);
      }

      if (startTime) {
        conditions.push(`start_time >= ?`);
        params.push(startTime);
      }

      if (endTime) {
        conditions.push(`start_time <= ?`);
        params.push(endTime);
      }

      const whereClause = conditions.length > 0
        ? `WHERE ${conditions.join(' AND ')}`
        : '';

      const sqlQuery = `
        SELECT * FROM event_summary
        ${whereClause}
        ORDER BY start_time DESC
        LIMIT 100
      `;

      const [rows] = await this.pool.query(sqlQuery, params);
      return rows;
    } catch (error) {
      this.logger.error('Error fetching events:', error);
      throw error;
    }
  }

  async getEventById(eventId) {
    try {
      const cachedData = await this.cacheManager.get(`event:${eventId}`);
      if (cachedData) {
        return JSON.parse(cachedData);
      }

      const [rows] = await this.pool.query(
        'SELECT * FROM event_summary WHERE id = ?',
        [eventId]
      );

      if (rows.length === 0) {
        return null;
      }

      const eventData = rows[0];

      await this.cacheManager.set(
        `event:${eventId}`,
        JSON.stringify(eventData),
        300 // Cache for 5 minutes
      );

      return eventData;
    } catch (error) {
      this.logger.error('Error fetching event by ID:', {
        eventId,
        error: error.message
      });
      throw error;
    }
  }

  async getEventOdds(eventId) {
    try {
      this.logger.debug('Fetching odds for event:', { eventId });

      const cachedData = await this.cacheManager.get(`odds:${eventId}`);

      if (cachedData) {
        this.logger.debug('Found odds in cache:', { eventId });
        return JSON.parse(cachedData);
      }

      this.logger.debug('Querying database for odds:', { eventId });

      const [rows] = await this.pool.query(
        `SELECT o.*, e.sport, e.competition
         FROM odds o
         JOIN events e ON o.event_id = e.id
         WHERE o.event_id = ?
         ORDER BY o.timestamp DESC`,
        [eventId]
      );

      this.logger.debug('Query results:', { 
        eventId, 
        rowCount: rows.length,
        firstRow: rows[0] 
      });

      const oddsData = {
        eventId,
        odds: rows
      };

      await this.cacheManager.set(
        `odds:${eventId}`,
        JSON.stringify(oddsData),
        60 // Cache for 1 minute
      );

      return oddsData;
    } catch (error) {
      this.logger.error('Error fetching event odds:', {
        eventId,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  async getSportEvents(sport) {
    try {
      const cachedData = await this.cacheManager.get(`sport:${sport}`);

      if (cachedData) {
        return JSON.parse(cachedData);
      }

      const [rows] = await this.pool.query(
        'SELECT * FROM event_summary WHERE sport = ? ORDER BY start_time DESC',
        [sport]
      );

      const sportData = {
        sport,
        events: rows
      };

      await this.cacheManager.set(
        `sport:${sport}`,
        JSON.stringify(sportData),
        300 // Cache for 5 minutes
      );

      return sportData;
    } catch (error) {
      this.logger.error('Error fetching sport events:', {
        sport,
        error: error.message
      });
      throw error;
    }
  }
}

module.exports = { ApiHandler }; 