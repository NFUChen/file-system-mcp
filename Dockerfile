FROM ghcr.io/open-webui/mcpo:main

# Set working directory
WORKDIR /app

# Install Node.js and TypeScript (mcpo is already included in the base image)
RUN apt-get update && apt-get install -y curl && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && \
    npm install -g typescript && \
    rm -rf /var/lib/apt/lists/*

# Copy all source files (needed for workspace build)
COPY . .

# Install dependencies and build
RUN npm install

# Expose port for HTTP access
EXPOSE 3000

# Use mcpo to wrap the filesystem server with OpenAPI REST endpoints
# Using ENTRYPOINT ensures mcpo is always used and can't be overridden
ENTRYPOINT ["mcpo", "--port", "3000", "--", "node", "src/filesystem/dist/index.js", "/workspace"]