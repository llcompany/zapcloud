FROM node:20-alpine

# Dependências do sistema
RUN apk add --no-cache openssl

WORKDIR /app

# Instalar dependências primeiro (cache de layers)
COPY package*.json ./
RUN npm ci --only=production

# Copiar o restante do projeto
COPY . .

# Gerar o Prisma Client (usa URL dummy só para gerar os tipos)
RUN DATABASE_URL="postgresql://dummy:dummy@dummy:5432/dummy" npx prisma generate

EXPOSE 3000

# Na inicialização: roda as migrations com a URL real e inicia o servidor
CMD ["sh", "-c", "npx prisma migrate deploy && node src/server.js"]
