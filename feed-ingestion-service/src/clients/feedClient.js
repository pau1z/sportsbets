const axios = require('axios');
const winston = require('winston');

class FeedClient {

  constructor() {
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.json(),
      transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'feed-client-error.log', level: 'error' })
      ]
    });

    this.client = axios.create({
      timeout: 10000,
      headers: {
        'User-Agent': 'SportsBettingFeedClient/1.0'
      }
    });
  }

  async fetchFeed(url, options = {}) {
    try {
      const response = await this.client.get(url, {
        ...options,
        headers: {
          ...this.client.defaults.headers,
          ...options.headers
        }
      });

      return response.data;
    } catch (error) {
      this.logger.error('Error fetching feed:', {
        url,
        error: error.message,
        status: error.response?.status,
        headers: error.response?.headers
      });

      if (error.response) {
        throw new Error(`Feed fetch failed with status ${error.response.status}: ${error.message}`);
      } else if (error.request) {
        throw new Error(`No response received from feed server: ${error.message}`);
      } else {
        throw new Error(`Error setting up feed request: ${error.message}`);
      }
    }
  }

}

module.exports = { FeedClient }; 