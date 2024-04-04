# Use an official Node.js runtime as a parent image
FROM node:16-alpine

# Set the working directory in the container
WORKDIR /app

# Copy package.json and package-lock.json to the working directory
COPY package*.json ./
COPY tsconfig.json ./
COPY src ./src

# Install dependencies
RUN npm ci

# Copy the rest of the application code to the working directory
COPY . .

# Build TypeScript files
RUN npm run build

# Entrypoint
ENTRYPOINT ["node", "dist/main"]

# Default arguments
CMD ["main", "foundation"]
