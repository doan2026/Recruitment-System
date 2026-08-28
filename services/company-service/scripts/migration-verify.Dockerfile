FROM node:20-bookworm

WORKDIR /verify
RUN npm init -y \
    && npm install --ignore-scripts --no-audit --no-fund prisma@5.22.0 @prisma/client@5.22.0
COPY prisma ./prisma
RUN mkdir -p ./baseline/migrations \
    && cp ./prisma/schema.prisma ./baseline/schema.prisma \
    && cp ./prisma/migrations/migration_lock.toml ./baseline/migrations/migration_lock.toml \
    && cp -R ./prisma/migrations/20260822000000_company_profile ./baseline/migrations/ \
    && cp -R ./prisma/migrations/20260824000000_company_members ./baseline/migrations/
RUN ./node_modules/.bin/prisma generate --schema ./prisma/schema.prisma

USER node
ENTRYPOINT []
