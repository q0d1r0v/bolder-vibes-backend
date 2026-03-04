FROM node:22-alpine AS base
WORKDIR /app

COPY package.json yarn.lock ./
RUN yarn install --non-interactive

COPY prisma ./prisma
COPY prisma.config.ts ./
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY tsconfig-paths-bootstrap.js ./
COPY src ./src
RUN yarn prisma:generate
RUN yarn build

FROM node:22-alpine AS production
WORKDIR /app

ENV NODE_ENV=production

COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/dist ./dist
COPY --from=base /app/prisma ./prisma
COPY --from=base /app/package.json ./package.json
COPY --from=base /app/tsconfig-paths-bootstrap.js ./tsconfig-paths-bootstrap.js

EXPOSE 3000

CMD ["yarn", "start:prod"]
