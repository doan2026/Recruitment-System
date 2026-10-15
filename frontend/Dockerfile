FROM node:20-alpine AS build
WORKDIR /app
ARG NEXT_PUBLIC_API_BASE_URL=/api
ARG NEXT_PUBLIC_API_MODE=gateway
ARG NEXT_PUBLIC_GOOGLE_LOGIN_ENABLED=false
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL \
    NEXT_PUBLIC_API_MODE=$NEXT_PUBLIC_API_MODE \
    NEXT_PUBLIC_GOOGLE_LOGIN_ENABLED=$NEXT_PUBLIC_GOOGLE_LOGIN_ENABLED \
    API_INTERNAL_BASE_URL=http://api-gateway
COPY package*.json ./
RUN npm ci
COPY app app
COPY components components
COPY lib lib
COPY types types
COPY public public
COPY next.config.mjs tsconfig.json next-env.d.ts ./
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production \
    API_INTERNAL_BASE_URL=http://api-gateway
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/.next .next
COPY --from=build /app/public ./public
COPY --from=build /app/next.config.mjs ./
EXPOSE 3000
CMD ["npm", "run", "start"]
