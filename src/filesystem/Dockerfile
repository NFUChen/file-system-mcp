FROM node:22.12-alpine AS builder

WORKDIR /app

COPY src/filesystem /app
COPY tsconfig.json /tsconfig.json

RUN --mount=type=cache,target=/root/.npm npm install

RUN --mount=type=cache,target=/root/.npm-production npm ci --ignore-scripts --omit-dev


FROM node:22-alpine AS release

# Install ripgrep and plocate
RUN apk add --no-cache ripgrep plocate

WORKDIR /app

COPY --from=builder /app/dist /app/dist
COPY --from=builder /app/package.json /app/package.json
COPY --from=builder /app/package-lock.json /app/package-lock.json

# Copy entrypoint script
COPY src/filesystem/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Create directory for plocate database
RUN mkdir -p /var/lib/plocate && chmod 755 /var/lib/plocate

ENV NODE_ENV=production
ENV PLOCATE_DB=/var/lib/plocate/plocate.db

RUN npm ci --ignore-scripts --omit-dev

ENTRYPOINT ["/entrypoint.sh"]