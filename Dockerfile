FROM node:20-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ src/
RUN npm run build

FROM node:20-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
    libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 \
    libgbm1 libpango-1.0-0 libcairo2 libasound2 libxshmfence1 \
    libx11-xcb1 fonts-liberation wget ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npx playwright install chromium

COPY --from=build /app/dist/ dist/
COPY ui3/ ui3/
COPY ui4/ ui4/
COPY ui5/ ui5/
COPY choose-ui.html ./

ENV PORT=3000
ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "dist/index.js"]
