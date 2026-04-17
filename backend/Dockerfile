# ============================================================
# Multi-stage Dockerfile para o backend NestJS.
# Targets:
#   - dev:  node 20 + todas as deps + nest start --watch (hot reload)
#   - prod: imagem enxuta so com dist/ + deps de producao, non-root
#
# Uso:
#   docker build --target dev  -t gy-backend:dev  ./backend
#   docker build --target prod -t gy-backend:prod ./backend
# ============================================================

# ---------- Base ----------
FROM node:20-alpine AS base
WORKDIR /app
COPY package.json package-lock.json* ./

# ---------- Dev: hot reload ----------
FROM base AS dev
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
COPY . .
EXPOSE 3000
CMD ["npm", "run", "start:dev"]

# ---------- Builder: compila TS -> dist/ ----------
FROM base AS builder
RUN npm ci
COPY . .
RUN npm run build

# ---------- Prod deps: so' runtime ----------
FROM base AS prod-deps
RUN npm ci --omit=dev

# ---------- Prod: imagem final ----------
FROM node:20-alpine AS prod
WORKDIR /app
ENV NODE_ENV=production

# so' precisamos do package.json pra referencia (versao, main, etc.)
COPY --from=builder /app/package.json ./
# node_modules apenas de producao
COPY --from=prod-deps /app/node_modules ./node_modules
# codigo compilado
COPY --from=builder /app/dist ./dist

# usuario nao-root
RUN addgroup -S nodeapp && adduser -S nodeapp -G nodeapp \
 && chown -R nodeapp:nodeapp /app
USER nodeapp

EXPOSE 3000
CMD ["node", "dist/main.js"]
