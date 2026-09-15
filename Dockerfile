ARG NODE_IMAGE=node:22-alpine
FROM ${NODE_IMAGE} AS verify
WORKDIR /app
COPY package.json server.cjs ./
COPY dist ./dist
COPY tests ./tests
RUN npm run build && npm test

FROM ${NODE_IMAGE} AS runtime
ARG APP_VERSION=local
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4173 APP_VERSION=${APP_VERSION}
WORKDIR /app
COPY --from=verify --chown=node:node /app/server.cjs ./
COPY --from=verify --chown=node:node /app/dist ./dist
USER node
EXPOSE 4173
HEALTHCHECK --interval=5s --timeout=3s --start-period=3s --retries=6 CMD node -e "fetch('http://127.0.0.1:4173/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server.cjs"]
