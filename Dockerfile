FROM node:22-alpine

WORKDIR /app

# Install system dependencies for native modules
RUN apk add --no-cache python3 make g++

# Copy package manifests and install ALL dependencies
# (ts-node and typescript are devDeps but required at runtime here)
COPY package*.json ./
RUN npm ci --prefer-offline

# Copy application source
COPY tsconfig.json ./
COPY src/ ./src/
COPY scripts/ ./scripts/
COPY public/ ./public/

# Expose API port
EXPOSE 3000

# Entrypoint: initialise DB schema then start the server
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
ENTRYPOINT ["docker-entrypoint.sh"]
