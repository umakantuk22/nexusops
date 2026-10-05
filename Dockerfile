# syntax=docker/dockerfile:1
FROM node:20-alpine AS base
WORKDIR /app

# Step 1: Install dependencies
COPY package.json ./
# If external dependencies are added in the future, npm ci can run here

# Step 2: Source code
COPY . .

# Step 3: Run as non-privileged user for container security
USER node

# Expose standard application port
EXPOSE 3000

ENV NODE_ENV=production
ENV APP_PORT=3000

# Health check probe
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/livez || exit 1

CMD ["node", "src/server/index.js"]
