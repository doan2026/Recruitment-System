FROM node:20-alpine AS build
RUN apk add --no-cache openssl
WORKDIR /app
ENV DATABASE_URL=postgresql://placeholder:placeholder@localhost:5432/placeholder
COPY package.json package-lock.json ./
RUN npm ci
COPY jest.config.js nest-cli.json tsconfig.json tsconfig.spec.json ./
COPY prisma prisma
RUN npx prisma generate
COPY src src
RUN npm run build

FROM build AS test
COPY test test
CMD ["npm", "test"]

FROM node:20-alpine
RUN apk add --no-cache openssl
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist dist
COPY --from=build /app/node_modules/.prisma node_modules/.prisma
COPY --from=build /app/prisma prisma
EXPOSE 3000
CMD ["npm", "run", "start:prod"]
