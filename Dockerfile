FROM node:20-slim AS build

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ src/
RUN npm run build

FROM mcr.microsoft.com/playwright:v1.52.0-noble AS runtime

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npx playwright install chromium --with-deps

COPY --from=build /app/dist/ dist/
COPY ui3/ ui3/
COPY ui4/ ui4/
COPY ui5/ ui5/
COPY choose-ui.html ./

ENV PORT=3000
EXPOSE 3000
VOLUME /app/data

CMD ["node", "dist/index.js"]
