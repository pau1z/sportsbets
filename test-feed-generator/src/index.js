const axios = require('axios');
const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' })
  ]
});

const INGESTION_SERVICE_URL = process.env.INGESTION_SERVICE_URL || 'http://feed-ingestion:3000';
const INTERVAL_MS = process.env.INTERVAL_MS || 5000; // Send data every 5 seconds

const sports = ['Football', 'Basketball', 'Tennis', 'Hockey'];

const competitions = {
  'Football': ['Premier League', 'La Liga', 'Bundesliga', 'Serie A'],
  'Basketball': ['NBA', 'EuroLeague', 'CBA'],
  'Tennis': ['ATP Tour', 'WTA Tour', 'Grand Slam'],
  'Hockey': ['NHL', 'KHL', 'SHL']
};

const teams = {
  'Football': [
    ['Manchester United', 'Liverpool'],
    ['Barcelona', 'Real Madrid'],
    ['Bayern Munich', 'Borussia Dortmund'],
    ['Juventus', 'Inter Milan']
  ],
  'Basketball': [
    ['Lakers', 'Celtics'],
    ['Barcelona', 'Real Madrid'],
    ['Guangdong', 'Beijing']
  ],
  'Tennis': [
    ['Djokovic', 'Nadal'],
    ['Swiatek', 'Sabalenka'],
    ['Federer', 'Murray']
  ],
  'Hockey': [
    ['Maple Leafs', 'Canadiens'],
    ['CSKA', 'SKA'],
    ['Frolunda', 'HV71']
  ]
};

function generateEvent() {
  const sport = sports[Math.floor(Math.random() * sports.length)];
  const competition = competitions[sport][Math.floor(Math.random() * competitions[sport].length)];
  const teamPair = teams[sport][Math.floor(Math.random() * teams[sport].length)];
  const startTime = new Date(Date.now() + Math.random() * 7 * 24 * 60 * 60 * 1000); // Random time in next 7 days

  return {
    id: `EVENT_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    sport,
    competition,
    startTime: startTime.toISOString(),
    status: 'SCHEDULED',
    participants: [
      { name: teamPair[0], type: 'HOME' },
      { name: teamPair[1], type: 'AWAY' }
    ],
    odds: [
      { market_type: 'MATCH_ODDS', selection: 'HOME', price: (1 + Math.random() * 3).toFixed(2) },
      { market_type: 'MATCH_ODDS', selection: 'AWAY', price: (1 + Math.random() * 3).toFixed(2) }
    ]
  };
}

async function sendData() {
  try {
    const event = generateEvent();
    const payload = {
      feedType: 'json',
      feedData: {
        events: [event]
      }
    };

    logger.info('Sending test data:', { eventId: event.id, sport: event.sport });
    
    const response = await axios.post(`${INGESTION_SERVICE_URL}/ingest`, payload);
    logger.info('Data sent successfully:', { 
      eventId: event.id, 
      status: response.data.status 
    });
  } catch (error) {
    logger.error('Error sending data:', {
      error: error.message,
      stack: error.stack
    });
  }
}

logger.info('Starting test feed generator...');
setInterval(sendData, INTERVAL_MS);

sendData(); 