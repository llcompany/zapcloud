FROM node:20-alpine

# Dependências do sistema
RUN apk add --no-cache openssl

WORKDIR /app

# Instalar dependências primeiro (cache de layers)
COPY package*.json ./
RUN npm ci --only=production

# Copiar o restante do projeto
COPY . .

# Gerar o Prisma Client
RUN npx prisma generate

EXPOSE 3000

CMD ["node", "src/server.js"]
