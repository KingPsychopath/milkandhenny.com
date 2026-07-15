FROM node:22-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

COPY --chown=node:node run-maintenance.mjs ./run-maintenance.mjs

USER node
CMD ["node", "run-maintenance.mjs"]
