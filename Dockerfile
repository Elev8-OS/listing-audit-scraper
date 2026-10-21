# Playwright-Image enthält Chromium + alle Systemabhängigkeiten.
# Die Version muss zur playwright-Version in package.json passen.
FROM mcr.microsoft.com/playwright:v1.49.1-jammy
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .
ENV NODE_ENV=production
CMD ["node", "server.js"]
