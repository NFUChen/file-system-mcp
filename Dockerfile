FROM node:20-alpine

# Set working directory
WORKDIR /app

# Install TypeScript globally
RUN npm install -g typescript

# Copy package files
COPY package*.json ./
COPY src/filesystem/package.json ./src/filesystem/

# Install dependencies
RUN npm install
RUN cd src/filesystem && npm install

# Copy source code
COPY . .

# Build the project
RUN npm run build

# Run tests
CMD ["npm", "run", "test"]