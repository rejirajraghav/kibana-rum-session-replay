FROM public.ecr.aws/docker/library/node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
EXPOSE 3002
CMD ["node", "--import", "@elastic/opentelemetry-node", "server.js"]
