FROM node:22.12

# Create app directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install packages
RUN npm install

# Copy the app code
COPY . .
COPY config/bot-sites.example.json config/bot-sites.json
COPY config/debug.example.json config/debug.json

# Build the project
RUN npm run build

# Expose ports
EXPOSE 3001

# Push the database schema against the runtime-mounted SQLite file, then start the app.
CMD if [ -n "$SQLITE_PATH" ]; then \
      mkdir -p "$(dirname "$SQLITE_PATH")" && \
      DRIZZLE_STRICT=false npm run db:push; \
    fi; \
    exec node --enable-source-maps dist/start-manager.js
