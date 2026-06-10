FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package.json ./
COPY server.js ./
COPY public ./public

EXPOSE 4326

USER node

CMD ["node", "server.js"]
