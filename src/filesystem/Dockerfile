FROM ghcr.io/open-webui/mcpo:main

# Set working directory
WORKDIR /app

# Install Node.js, TypeScript, and additional dependencies (mcpo is already included in the base image)
RUN apt-get update && apt-get install -y curl && \
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y nodejs && \
    npm install -g typescript && \
    apt-get install -y ripgrep plocate && \
    rm -rf /var/lib/apt/lists/*

# Copy filesystem source files for building
COPY src/filesystem /app/filesystem
COPY tsconfig.json /tsconfig.json

# Build the TypeScript code
WORKDIR /app/filesystem
RUN npm install
RUN npm run build

# Copy entrypoint script and make it executable
COPY src/filesystem/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Create directory for plocate database
RUN mkdir -p /var/lib/plocate && chmod 755 /var/lib/plocate

# Environment variables
ENV NODE_ENV=production
ENV PLOCATE_DB=/var/lib/plocate/plocate.db

# Clean up dev dependencies
RUN npm ci --ignore-scripts --omit=dev

# Expose port for HTTP access
EXPOSE 3000

# Use mcpo to wrap the filesystem server with OpenAPI REST endpoints
# The entrypoint script will handle plocate setup and then start the server
ENTRYPOINT ["/entrypoint.sh"]