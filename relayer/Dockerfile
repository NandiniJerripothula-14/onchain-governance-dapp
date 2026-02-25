FROM node:20-alpine

WORKDIR /usr/src/app
RUN apk add --no-cache curl

COPY package*.json ./
RUN npm ci

COPY src ./src
RUN mkdir -p /usr/src/app/data

CMD ["npm", "start"]
