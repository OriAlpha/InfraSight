# ==========================================
# Stage 1: Build the React Frontend
# ==========================================
FROM node:20-slim AS client-builder
WORKDIR /app/client

# Copy client package config
COPY client/package*.json ./
RUN npm ci

# Copy client source code and build it
COPY client/ ./
RUN npm run build

# ==========================================
# Stage 2: Install Server Dependencies
# ==========================================
FROM node:20-slim AS server-installer
WORKDIR /app/server

# Install build dependencies required for compiling native C++ addons (better-sqlite3)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Copy server package config and install production dependencies
COPY server/package*.json ./
RUN npm ci --omit=dev

# ==========================================
# Stage 3: Final Production Image
# ==========================================
FROM node:20-slim AS runner
WORKDIR /app

# Install runtime dependencies if needed, and clean up
RUN apt-get update && apt-get install -y \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Set node environment to production
ENV NODE_ENV=production
ENV PORT=3000
ENV DB_PATH=/app/data/infrasight.db

# Copy built frontend assets
COPY --from=client-builder /app/client/dist /app/client/dist

# Copy installed backend dependencies and server code
COPY --from=server-installer /app/server/node_modules /app/server/node_modules
COPY server/ /app/server/

# Create directory for SQLite persistent data
RUN mkdir -p /app/data

# Expose server port
EXPOSE 3000

# Start server
WORKDIR /app/server
CMD ["node", "index.js"]
