const winston = require('winston');

class JSONParser {

  constructor() {
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.json(),
      transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'json-parser-error.log', level: 'error' })
      ]
    });
  }

  async parse(jsonData) {
    try {
      const data = typeof jsonData === 'string' ? JSON.parse(jsonData) : jsonData;
      return this.transformData(data);
    } catch (error) {
      this.logger.error('Error parsing JSON:', error);
      throw new Error(`Failed to parse JSON: ${error.message}`);
    }
  }

  transformData(data) {
    const transformed = {
      timestamp: new Date().toISOString(),
      events: []
    };

    if (data.events) {
      // Handle events array structure
      transformed.events = data.events
        .filter(event => this.validateEvent(event))
        .map(event => this.transformEvent(event));
    } else if (data.sports) {
      // Handle sports object structure
      Object.entries(data.sports).forEach(([sport, events]) => {
        const sportEvents = Array.isArray(events) ? events : [events];
        transformed.events.push(...sportEvents
          .filter(event => this.validateEvent(event))
          .map(event => ({
            ...this.transformEvent(event),
            sport
          })));
      });
    } else if (data.odds) {
      // Handle odds-only structure
      transformed.events = this.transformOddsFeed(data.odds);
    }

    return transformed;
  }

  validateEvent(event) {
    if (!event || !event.id) {
      this.logger.warn('Skipping event with missing ID:', event);
      return false;
    }
    return true;
  }

  transformEvent(event) {
    if (!this.validateEvent(event)) {
      throw new Error('Cannot transform event without ID');
    }

    return {
      id: event.id,
      sport: event.sport || 'UNKNOWN',
      competition: event.competition || 'UNKNOWN',
      startTime: event.startTime || event.start_time || new Date().toISOString(),
      status: event.status || 'UNKNOWN',
      participants: this.transformParticipants(event.participants),
      odds: this.transformOdds(event.odds)
    };
  }

  transformParticipants(participants) {
    if (!participants) return [];
    
    const participantList = Array.isArray(participants) ? participants : [participants];
    
    return participantList
      .filter(p => p && p.name) // Only include participants with names
      .map(p => ({
        id: p.id || null,
        name: p.name,
        type: p.type || 'UNKNOWN'
      }));
  }

  transformOdds(odds) {
    if (!odds) return [];
    
    const oddsList = Array.isArray(odds) ? odds : [odds];
    
    return oddsList
      .filter(odd => odd && odd.market_type && odd.selection && odd.price)
      .map(odd => ({
        market_type: odd.market_type,
        selection: odd.selection,
        price: parseFloat(odd.price) || 0
      }));
  }

  transformOddsFeed(oddsData) {
    const events = [];
    const oddsList = Array.isArray(oddsData) ? oddsData : [oddsData];

    oddsList.forEach(odd => {
      if (!odd || !odd.eventId) {
        this.logger.warn('Skipping odds with missing eventId:', odd);
        return;
      }

      const eventId = odd.eventId;
      let event = events.find(e => e.id === eventId);

      if (!event) {
        event = {
          id: eventId,
          sport: 'UNKNOWN',
          competition: 'UNKNOWN',
          startTime: new Date().toISOString(),
          status: 'UNKNOWN',
          odds: []
        };
        events.push(event);
      }

      if (odd.type && odd.value) {
        event.odds.push({
          market_type: odd.type,
          selection: 'UNKNOWN',
          price: parseFloat(odd.value) || 0
        });
      }
    });

    return events;
  }
}

module.exports = { JSONParser }; 