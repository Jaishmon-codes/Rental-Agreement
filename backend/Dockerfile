# RentSphere Enterprise Backend Production Container
FROM node:22-alpine AS runtime

WORKDIR /app

# Security: Don't run as root
RUN apk add --no-cache wget && \
    mkdir -p /app/uploads /app/data && \
    chown -R node:node /app

USER node

# Install production dependencies
COPY --chown=node:node backend/package*.json ./
RUN npm ci --omit=dev

# Copy application source
COPY --chown=node:node backend/ ./

ENV NODE_ENV=production \
    PORT=4000 \
    DB_PATH=/app/data/rental_database.sqlite \
    DOCUMENT_STORAGE_DIR=/app/uploads

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:4000/api/health/ready || exit 1

CMD ["node", "server.js"]
