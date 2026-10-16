FROM node:20-alpine

WORKDIR /app

COPY package.json ./
COPY server.js ./
COPY src ./src
COPY public ./public
COPY qimao.json ./
COPY qidian.json ./

ENV PORT=3000
EXPOSE 3000

CMD ["node", "server.js"]
