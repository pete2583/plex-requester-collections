# Use a lightweight Node.js environment
FROM node:20-alpine

# Set the working directory inside the container
WORKDIR /usr/src/app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Install tsx globally to bypass strict TS compilation
RUN npm install -g tsx

# Copy the rest of your source code
COPY . .

# Run the raw file directly, ignoring TypeScript warnings
CMD ["tsx", "index.ts"]
