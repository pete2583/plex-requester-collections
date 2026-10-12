# Use a lightweight Node.js environment
FROM node:20-alpine

# Set the working directory inside the container
WORKDIR /usr/src/app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy the rest of your source code
COPY . .

# THIS IS THE MAGIC LINE: Compile the TypeScript into the /dist/ folder
RUN npm run build

# Start the application
CMD ["npm", "start"]
