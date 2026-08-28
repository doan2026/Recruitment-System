ARG NODE_IMAGE
FROM ${NODE_IMAGE} AS base
RUN apk add --no-cache openssl

FROM base AS build
WORKDIR /app
ENV DATABASE_URL=postgresql://placeholder:placeholder@localhost:5432/placeholder
COPY package.json .
RUN npm install
COPY nest-cli.json tsconfig.json ./
COPY prisma prisma
COPY src src
RUN npm run build

FROM base
WORKDIR /app
ENV NODE_ENV=production
COPY package.json .
RUN npm install --omit=dev
COPY --from=build /app/dist dist
COPY --from=build /app/node_modules/.prisma node_modules/.prisma
COPY --from=build /app/prisma prisma
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -O - http://127.0.0.1:3000/health || exit 1
CMD ["npm", "run", "start:prod"]
