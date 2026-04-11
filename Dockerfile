FROM node:20-alpine

# Dependências do sistema
RUN apk add --no-cache openssl

WORKDIR /app

# Definir URL temporária para o build (Railway vai sobrescrever na execução)
ENV DATABASE_URL="postgresql://dummy:dummy@dummy:5432/dummy"

# Instalar dependências (inclui prisma generate via postinstall)
COPY package*.json ./
RUN npm ci --only=production

# Copiar o restante do projeto e gerar o Prisma Client
COPY . .
RUN npx prisma generate

EXPOSE 3000

# Na inicialização: roda as migrations com a URL real do Railway e inicia o servidor
CMD ["sh", "-c", "npx prisma migrate deploy && node src/server.js"]
