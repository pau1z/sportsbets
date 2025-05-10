class WebSocketHandler {

  constructor(io, pool, cacheManager, logger) {
    this.io = io;
    this.pool = pool;
    this.cacheManager = cacheManager;
    this.logger = logger;
    this.subscriptions = new Map();
  }

  handleConnection(socket) {
    this.logger.info('New WebSocket connection', { socketId: socket.id });

    socket.on('subscribe:event', async (eventId) => {
      try {
        await this.subscribeToEvent(socket, eventId);
      } catch (error) {
        this.logger.error('Error subscribing to event:', {
          socketId: socket.id,
          eventId,
          error: error.message
        });
        socket.emit('error', { message: 'Failed to subscribe to event' });
      }
    });

    socket.on('unsubscribe:event', (eventId) => {
      this.unsubscribeFromEvent(socket, eventId);
    });

    socket.on('subscribe:sport', async (sport) => {
      try {
        await this.subscribeToSport(socket, sport);
      } catch (error) {
        this.logger.error('Error subscribing to sport:', {
          socketId: socket.id,
          sport,
          error: error.message
        });
        socket.emit('error', { message: 'Failed to subscribe to sport' });
      }
    });

    socket.on('unsubscribe:sport', (sport) => {
      this.unsubscribeFromSport(socket, sport);
    });
  }

  handleDisconnection(socket) {
    this.logger.info('WebSocket disconnection', { socketId: socket.id });
    
    if (this.subscriptions.has(socket.id)) {
      const subscriptions = this.subscriptions.get(socket.id);
      
      for (const eventId of subscriptions.events) {
        this.unsubscribeFromEvent(socket, eventId);
      }
      
      for (const sport of subscriptions.sports) {
        this.unsubscribeFromSport(socket, sport);
      }
      
      this.subscriptions.delete(socket.id);
    }
  }

  async subscribeToEvent(socket, eventId) {
    if (!this.subscriptions.has(socket.id)) {
      this.subscriptions.set(socket.id, { events: new Set(), sports: new Set() });
    }

    const subscriptions = this.subscriptions.get(socket.id);

    subscriptions.events.add(eventId);
    socket.join(`event:${eventId}`);

    const eventData = await this.getEventData(eventId);
    
    if (eventData) {
      socket.emit('event:update', eventData);
    }
  }

  unsubscribeFromEvent(socket, eventId) {
    if (this.subscriptions.has(socket.id)) {
      const subscriptions = this.subscriptions.get(socket.id);
      subscriptions.events.delete(eventId);
      socket.leave(`event:${eventId}`);
    }
  }

  async subscribeToSport(socket, sport) {
    if (!this.subscriptions.has(socket.id)) {
      this.subscriptions.set(socket.id, { events: new Set(), sports: new Set() });
    }

    const subscriptions = this.subscriptions.get(socket.id);
    
    subscriptions.sports.add(sport);
    socket.join(`sport:${sport}`);

    const sportData = await this.getSportData(sport);
    
    if (sportData) {
      socket.emit('sport:update', sportData);
    }
  }

  unsubscribeFromSport(socket, sport) {
    if (this.subscriptions.has(socket.id)) {
      const subscriptions = this.subscriptions.get(socket.id);
      subscriptions.sports.delete(sport);
      socket.leave(`sport:${sport}`);
    }
  }

  async getEventData(eventId) {
    try {
      const cachedData = await this.cacheManager.get(`event:${eventId}`);
      
      if (cachedData) {
        return JSON.parse(cachedData);
      }

      const [rows] = await this.pool.query(
        'SELECT * FROM event_summary WHERE id = ?', [eventId]
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
      this.logger.error('Error fetching event data:', {
        eventId,
        error: error.message
      });
      throw error;
    }
  }

  async getSportData(sport) {
    try {
      const cachedData = await this.cacheManager.get(`sport:${sport}`);
      
      if (cachedData) {
        return JSON.parse(cachedData);
      }

      const [rows] = await this.pool.query(
        'SELECT * FROM event_summary WHERE sport = ? ORDER BY start_time DESC', [sport]
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
      this.logger.error('Error fetching sport data:', {
        sport,
        error: error.message
      });
      throw error;
    }
  }

  async broadcastEventUpdate(eventId, eventData) {
    this.io.to(`event:${eventId}`).emit('event:update', eventData);
  }

  async broadcastSportUpdate(sport, sportData) {
    this.io.to(`sport:${sport}`).emit('sport:update', sportData);
  }
}

module.exports = { WebSocketHandler }; 