FROM node:20-alpine AS build
WORKDIR /app
ENV DATABASE_URL=postgresql://placeholder:placeholder@localhost:5432/placeholder
COPY package.json .
RUN npm install
COPY nest-cli.json tsconfig.json ./
COPY prisma prisma
RUN npx prisma generate
COPY src src
RUN npm run build
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json .
RUN npm install --omit=dev
COPY --from=build /app/dist dist
COPY --from=build /app/node_modules/.prisma node_modules/.prisma
COPY --from=build /app/prisma prisma
EXPOSE 3000
CMD ["npm", "run", "start:prod"]
