FROM node:20-alpine

# Instala dependências do sistema necessárias para o Prisma no Alpine
RUN apk add --no-cache openssl

WORKDIR /app

# Copia manifests de pacotes
COPY package*.json ./
COPY prisma ./prisma/

# Instala todas as dependências (inclusive devDependencies para Prisma CLI)
RUN npm install

# Copia o código-fonte da aplicação
COPY . .

# Gera o client do Prisma dentro do container
RUN npx prisma generate

# Porta padrão do Dashboard e Express
EXPOSE 3001

# Aplica eventuais mudanças no banco SQLite persistente e inicia o bot
CMD ["sh", "-c", "npx prisma db push && node src/index.js"]
