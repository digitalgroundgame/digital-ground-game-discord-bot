FROM node:24

# Create app directory
WORKDIR /app

# Copy package metadata and the shared Node version check.
COPY .nvmrc package*.json ./
COPY scripts/check-node-version.mjs scripts/check-node-version.mjs

# Install packages
RUN NODE_VERSION_CHECK=major npm ci

# Copy the app code
COPY . .
COPY config/bot-sites.example.json config/bot-sites.json
COPY config/debug.example.json config/debug.json

# Build the project
RUN npm run build

# Expose ports
EXPOSE 3001

# Let Coolify verify that the manager API is accepting requests.
HEALTHCHECK --interval=30s --timeout=5s --start-period=5m --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/health').then((response) => { if (!response.ok) process.exit(1) }).catch(() => process.exit(1))"

# Push the database schema against the runtime-mounted SQLite file, then start the app.
CMD if [ -n "$SQLITE_PATH" ]; then \
      mkdir -p "$(dirname "$SQLITE_PATH")" && \
      DRIZZLE_STRICT=false npm run db:push; \
    fi; \
    exec node --enable-source-maps dist/start-manager.js
