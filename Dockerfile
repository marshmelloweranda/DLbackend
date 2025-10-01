FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./

RUN npm install --only=production

# stage 2

FROM node:20-alpine AS production

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY package*.json ./

COPY . .

ENV NODE_ENV production

EXPOSE 8888

CMD ["npm", "start"]