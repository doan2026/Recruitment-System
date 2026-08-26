FROM node:24-alpine AS build
RUN apk add --no-cache openssl
WORKDIR /app
ENV DATABASE_URL=postgresql://placeholder:placeholder@localhost:5432/placeholder
COPY package.json package-lock.json ./
RUN npm ci
COPY nest-cli.json tsconfig.json ./
COPY prisma prisma
RUN npx prisma generate
COPY src src
COPY test test
RUN npm run build

FROM build AS test
CMD ["npm", "test"]

FROM node:24-alpine AS runtime
RUN apk add --no-cache openssl
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist dist
COPY --from=build /app/node_modules/.prisma node_modules/.prisma
COPY --from=build /app/prisma prisma
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD wget -q -O - http://127.0.0.1:3000/health || exit 1
CMD ["node", "dist/main"]
