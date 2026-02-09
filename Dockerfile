FROM node:20-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends sqlite3 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
ENV PORT=5173
ENV VOCAB_DB_PATH=/data/vocab.sqlite

EXPOSE 5173

CMD ["node", "scripts/dev.js"]
