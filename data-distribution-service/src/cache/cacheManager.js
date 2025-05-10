class CacheManager {

  constructor(redisClient, logger) {
    this.redisClient = redisClient;
    this.logger = logger;
  }

  async get(key) {
    try {
      return await this.redisClient.get(key);
    } catch (error) {
      this.logger.error('Error getting from cache:', { key, error: error.message });
      return null;
    }
  }

  async set(key, value, ttlSeconds = 300) {
    try {
      await this.redisClient.set(key, value, {
        EX: ttlSeconds
      });
    } catch (error) {
      this.logger.error('Error setting cache:', { key, error: error.message });
    }
  }

  async del(key) {
    try {
      await this.redisClient.del(key);
    } catch (error) {
      this.logger.error('Error deleting from cache:', {
        key,
        error: error.message
      });
    }
  }

  async invalidatePattern(pattern) {
    try {
      const keys = await this.redisClient.keys(pattern);
      if (keys.length > 0) {
        await this.redisClient.del(keys);
      }
    } catch (error) {
      this.logger.error('Error invalidating cache pattern:', {
        pattern,
        error: error.message
      });
    }
  }

  async invalidateEvent(eventId) {
    await Promise.all([
      this.del(`event:${eventId}`),
      this.del(`odds:${eventId}`)
    ]);
  }

  async invalidateSport(sport) {
    await this.del(`sport:${sport}`);
  }
}

module.exports = { CacheManager }; 