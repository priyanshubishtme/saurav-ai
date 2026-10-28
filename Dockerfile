FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=0

WORKDIR /app

# Keep npm's workspace graph and lockfile available for a reproducible backend install.
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json

RUN npm ci --omit=dev --workspace backend --include-workspace-root=false

# Install the browser matching the locked Playwright version plus Debian libraries.
RUN npm exec --workspace backend -- playwright install --with-deps chromium

COPY backend/src ./backend/src
COPY backend/scripts ./backend/scripts

RUN npm run build --workspace backend \
    && node --input-type=module -e "import { chromium } from 'playwright'; const browser = await chromium.launch({ headless: true }); await browser.close(); console.log('Playwright Chromium launch check passed.');"

EXPOSE 3001
USER node

CMD ["npm", "run", "start", "--workspace", "backend"]
