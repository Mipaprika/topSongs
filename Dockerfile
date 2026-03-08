FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY src ./src
COPY tsconfig.json ./

RUN mkdir -p /app/data

CMD ["tail", "-f", "/dev/null"]
