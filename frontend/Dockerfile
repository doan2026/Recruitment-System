FROM node:20-alpine AS build
WORKDIR /app
ARG NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
COPY package*.json ./
RUN npm install
COPY app app
COPY components components
COPY lib lib
COPY next.config.mjs tsconfig.json next-env.d.ts ./
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm install --omit=dev
COPY --from=build /app/.next .next
COPY --from=build /app/next.config.mjs ./
EXPOSE 3000
CMD ["npm", "run", "start"]
