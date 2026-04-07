FROM node:20-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ src/
RUN npm run build

FROM node:20-slim AS runtime

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
    && npx playwright install --with-deps chromium \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/dist/ dist/
COPY ui3/ ui3/
COPY ui4/ ui4/
COPY ui5/ ui5/
COPY choose-ui.html ./

ENV PORT=3000
ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "dist/index.js"]
