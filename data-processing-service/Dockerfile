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
ENV PORT=4001

# Expose port
EXPOSE 4001

# Start the service
CMD ["node", "src/index.js"] 