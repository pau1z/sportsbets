const { parseString } = require('xml2js');
const { promisify } = require('util');
const winston = require('winston');
const parseXml = promisify(parseString);

class XMLParser {

  constructor() {
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.json(),
      transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'xml-parser-error.log', level: 'error' })
      ]
    });
  }

  async parse(xmlData) {
    try {
      const result = await parseXml(xmlData, {
        explicitArray: false,
        mergeAttrs: true
      });

      return this.transformData(result);
    } catch (error) {
      this.logger.error('Error parsing XML:', error);
      throw new Error(`Failed to parse XML: ${error.message}`);
    }
  }

  transformData(data) {
    const transformed = {
      timestamp: new Date().toISOString(),
      events: []
    };

    if (data.sports) {
      // Handle sports feed structure
      const events = Array.isArray(data.sports.event) 
        ? data.sports.event 
        : [data.sports.event];

      transformed.events = events.map(event => ({
        id: event.id,
        sport: event.sport,
        competition: event.competition,
        startTime: event.startTime,
        status: event.status,
        participants: this.parseParticipants(event.participants),
        odds: this.parseOdds(event.odds)
      }));
    } else if (data.odds) {
      // Handle odds-only feed structure
      transformed.events = this.parseOddsFeed(data.odds);
    }

    return transformed;
  }

  parseParticipants(participants) {
    if (!participants) return [];
    
    const participantList = Array.isArray(participants.participant)
      ? participants.participant
      : [participants.participant];

    return participantList.map(p => ({
      id: p.id,
      name: p.name,
      type: p.type
    }));
  }

  parseOdds(odds) {
    if (!odds) return [];
    
    const oddsList = Array.isArray(odds.odd)
      ? odds.odd
      : [odds.odd];

    return oddsList.map(odd => ({
      type: odd.type,
      value: parseFloat(odd.value),
      bookmaker: odd.bookmaker,
      timestamp: odd.timestamp
    }));
  }

  parseOddsFeed(oddsData) {
    const events = [];
    const oddsList = Array.isArray(oddsData.odd)
      ? oddsData.odd
      : [oddsData.odd];

    oddsList.forEach(odd => {
      const eventId = odd.eventId;
      let event = events.find(e => e.id === eventId);

      if (!event) {
        event = {
          id: eventId,
          odds: []
        };
        events.push(event);
      }

      event.odds.push({
        type: odd.type,
        value: parseFloat(odd.value),
        bookmaker: odd.bookmaker,
        timestamp: odd.timestamp
      });
    });

    return events;
  }
}

module.exports = { XMLParser }; 