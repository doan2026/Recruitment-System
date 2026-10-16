FROM node:20-bookworm-slim AS build
WORKDIR /app
ARG NEXT_PUBLIC_API_BASE_URL=/api
ARG NEXT_PUBLIC_API_MODE=gateway
ARG NEXT_PUBLIC_GOOGLE_LOGIN_ENABLED=false
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL \
    NEXT_PUBLIC_API_MODE=$NEXT_PUBLIC_API_MODE \
    NEXT_PUBLIC_GOOGLE_LOGIN_ENABLED=$NEXT_PUBLIC_GOOGLE_LOGIN_ENABLED \
    API_INTERNAL_BASE_URL=http://api-gateway
ENV PUPPETEER_SKIP_DOWNLOAD=true
COPY package*.json ./
RUN npm ci
COPY app app
COPY components components
COPY lib lib
COPY types types
COPY public public
COPY next.config.mjs tsconfig.json next-env.d.ts ./
RUN npm run build

FROM node:20-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    API_INTERNAL_BASE_URL=http://api-gateway
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
