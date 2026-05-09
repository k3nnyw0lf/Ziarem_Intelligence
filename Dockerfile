FROM node:20-alpine
WORKDIR /app

# Install deps with cache layer
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY . .

# Health check hits /health (defined in src/server.js)
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -q -O- http://localhost:${PORT:-3001}/health || exit 1

ENV NODE_ENV=production
EXPOSE 3001

CMD ["node", "src/server.js"]
