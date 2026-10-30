FROM node:24-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts

FROM node:24-alpine AS production
ENV NODE_ENV=production
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json auth-config.mjs email-handoff.mjs policy.mjs server-core.mjs server.mjs ./
USER node
EXPOSE 3000
CMD ["node", "server.mjs"]

FROM production AS development-mock
ENV NODE_ENV=development
COPY mock-server.mjs ./
CMD ["node", "mock-server.mjs"]
