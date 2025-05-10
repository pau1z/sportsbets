FROM node:18-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install

# Copy source code
COPY src/ ./src/

# Create logs directory
RUN mkdir -p /app/logs

# Set environment variables
ENV NODE_ENV=production
ENV PORT=5000
ENV WS_PORT=5001

# Expose ports
EXPOSE 5000 5001

# Start the service
CMD ["node", "src/index.js"] 