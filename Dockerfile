# ---- build the frontend ----
FROM node:24-slim AS build
WORKDIR /app
RUN npm install -g pnpm@11
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY index.html vite.config.js ./
COPY src ./src
RUN pnpm build

# ---- runtime: just node + thumbnail tools ----
FROM node:24-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg libvips-tools \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY server.js package.json ./

# data/, photos.db and .thumbs/ live here (bind-mounted from the host folder)
ENV STORAGE_DIR=/storage
ENV PORT=3000
EXPOSE 3000
CMD ["node", "server.js"]
