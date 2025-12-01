FROM node:20-alpine
RUN apk add --no-cache openssl

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

# Expose the port Render will connect to
EXPOSE 3000

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy rest of app
COPY . .

# Build
RUN npm run build

# Start the Remix/React Router server
CMD ["npm", "run", "start"]