FROM node:20-alpine

WORKDIR /app

COPY backend/package*.json ./backend/
RUN cd backend && npm ci --omit=dev

COPY . .

ENV NODE_ENV=production

EXPOSE 3001

CMD ["node", "backend/server.js"]
