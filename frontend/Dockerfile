# ============================================================
# Multi-stage Dockerfile do frontend Angular.
# Targets:
#   - dev:  node 20 + ng serve --host 0.0.0.0 --port 4200 (hot reload)
#   - prod: nginx:alpine servindo os estaticos do `ng build`, porta 80
# ============================================================

# ---------- Base (Node) ----------
FROM node:20-alpine AS base
WORKDIR /app
COPY package.json package-lock.json* ./

# ---------- Dev: ng serve ----------
FROM base AS dev
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
COPY . .
EXPOSE 4200
CMD ["npm", "start"]

# ---------- Builder: ng build -> dist/ ----------
FROM base AS builder
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
COPY . .
RUN npm run build

# ---------- Prod: nginx servindo os estaticos ----------
FROM nginx:alpine AS prod

# nginx.conf customizado: SPA fallback, gzip, cache longo para assets
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Angular gera em dist/<projeto>/browser (Angular 17+ com esbuild)
COPY --from=builder /app/dist/frontend/browser /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
