# ── Stage 1: Build ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
RUN apk add --no-cache openssl
WORKDIR /app

# URL dummy só para o build (prisma generate)
ENV DATABASE_URL="postgresql://dummy:dummy@dummy:5432/dummy"

COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN npx prisma generate

# ── Stage 2: Runtime (imagem limpa, sem DATABASE_URL) ──────────────────────────
FROM node:20-alpine
RUN apk add --no-cache openssl
WORKDIR /app

# Copia tudo do builder (incluindo node_modules com prisma gerado)
COPY --from=builder /app .

EXPOSE 3000

# Railway injeta DATABASE_URL real automaticamente aqui
CMD ["node", "src/server.js"]
