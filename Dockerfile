FROM node:20-alpine
RUN apk add --no-cache openssl

WORKDIR /app
ENV NODE_ENV=production

# Expose the port Render will connect to
EXPOSE 3000

# 1) Nainstaluj všechny dependencies (včetně dev), aby bylo dostupné `prisma`
COPY package.json package-lock.json* ./
RUN npm ci && npm cache clean --force

# 2) Zbytek aplikace
COPY . .

# 3) Vygeneruj Prisma client
RUN npx prisma generate

# 4) Buildni aplikaci
RUN npm run build

# 5) Start serveru (react-router-serve ./build/server/index.js)
CMD ["npm", "run", "start"]