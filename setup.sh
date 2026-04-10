#!/bin/bash

# ══════════════════════════════════════════════════════════
#  ZapCloud - Script de Setup Automático
#  Uso: chmod +x setup.sh && ./setup.sh
# ══════════════════════════════════════════════════════════

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}"
echo "  ╔══════════════════════════════════╗"
echo "  ║   ZapCloud Backend - Setup       ║"
echo "  ╚══════════════════════════════════╝"
echo -e "${NC}"

# ── Verificar dependências ─────────────────────────────────────────────────

check() {
  if ! command -v $1 &> /dev/null; then
    echo -e "${RED}✗ $1 não encontrado. Por favor, instale antes de continuar.${NC}"
    exit 1
  fi
  echo -e "${GREEN}✓ $1 disponível${NC}"
}

echo -e "\n${YELLOW}▶ Verificando dependências...${NC}"
check node
check npm
check docker
check docker-compose 2>/dev/null || check "docker compose"

# ── Criar .env se não existir ──────────────────────────────────────────────

echo -e "\n${YELLOW}▶ Configurando variáveis de ambiente...${NC}"

if [ ! -f .env ]; then
  cp .env.example .env

  # Gerar JWT secrets aleatórios
  JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  JWT_REFRESH_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  VERIFY_TOKEN=$(node -e "console.log(require('crypto').randomBytes(16).toString('hex'))")

  # Substituir no .env
  sed -i "s/sua_chave_secreta_muito_forte_aqui/$JWT_SECRET/" .env
  sed -i "s/sua_chave_refresh_muito_forte_aqui/$JWT_REFRESH_SECRET/" .env
  sed -i "s/token_verificacao_webhook_customizado/$VERIFY_TOKEN/" .env

  # PostgreSQL local via Docker
  sed -i 's|DATABASE_URL=.*|DATABASE_URL="postgresql://zapcloud:zapcloud123@localhost:5432/zapcloud?schema=public"|' .env

  echo -e "${GREEN}✓ .env criado com chaves seguras geradas automaticamente${NC}"
  echo -e "${YELLOW}  ⚠  Preencha META_APP_ID, META_APP_SECRET e META_REDIRECT_URI no .env${NC}"
else
  echo -e "${GREEN}✓ .env já existe${NC}"
fi

# ── Instalar dependências Node ─────────────────────────────────────────────

echo -e "\n${YELLOW}▶ Instalando dependências Node.js...${NC}"
npm install
echo -e "${GREEN}✓ Dependências instaladas${NC}"

# ── Subir PostgreSQL com Docker ────────────────────────────────────────────

echo -e "\n${YELLOW}▶ Iniciando banco de dados PostgreSQL...${NC}"
docker-compose up -d db

echo -n "  Aguardando PostgreSQL ficar pronto"
until docker-compose exec -T db pg_isready -U zapcloud -q 2>/dev/null; do
  echo -n "."
  sleep 1
done
echo -e "\n${GREEN}✓ PostgreSQL pronto${NC}"

# ── Rodar migrations ───────────────────────────────────────────────────────

echo -e "\n${YELLOW}▶ Rodando migrations do banco de dados...${NC}"
npx prisma migrate dev --name init
echo -e "${GREEN}✓ Migrations aplicadas${NC}"

# ── Gerar Prisma Client ────────────────────────────────────────────────────

echo -e "\n${YELLOW}▶ Gerando Prisma Client...${NC}"
npx prisma generate
echo -e "${GREEN}✓ Prisma Client gerado${NC}"

# ── Resumo ─────────────────────────────────────────────────────────────────

echo -e "\n${GREEN}"
echo "  ══════════════════════════════════════════"
echo "   ✅ Setup concluído com sucesso!"
echo "  ══════════════════════════════════════════"
echo ""
echo "   Para iniciar o servidor:"
echo "     npm run dev"
echo ""
echo "   Endpoints disponíveis em:"
echo "     http://localhost:3000"
echo ""
echo "   Banco de dados (Adminer UI):"
echo "     docker-compose up -d adminer"
echo "     http://localhost:8080"
echo "     Servidor: db | Usuário: zapcloud | Senha: zapcloud123"
echo ""
echo "   Para testar os endpoints:"
echo "     Abra zapcloud.http no VS Code (extensão REST Client)"
echo -e "  ══════════════════════════════════════════\n${NC}"
