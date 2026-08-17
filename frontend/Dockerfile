FROM public.ecr.aws/docker/library/node:20-alpine
WORKDIR /app

# Copy and install deps
COPY package.json ./
RUN npm install

# Copy source + pre-built RUM bundle
COPY . .

# The RUM bundle is copied from the package build output at docker build time
# via the build context — see Makefile/README for build steps
EXPOSE 3000
CMD ["node", "server.js"]
