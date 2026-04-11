FROM node:20-alpine

# Dependências do sistema
RUN apk add --no-cache openssl

WORKDIR /app

# ARG só existe durante o build, não contamina o container em execução
ARG DATABASE_URL=postgresql://dummy:dummy@dummy:5432/dummy

# Instalar dependências (prisma postinstall usa o ARG acima)
COPY package*.json ./
RUN DATABASE_URL=${DATABASE_URL} npm ci --only=production

# Copiar projeto e gerar Prisma Client
COPY . .
RUN DATABASE_URL=${DATABASE_URL} npx prisma generate

EXPOSE 3000

# Em execução, Railway injeta o DATABASE_URL real automaticamente
CMD ["node", "src/server.js"]
