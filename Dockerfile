# syntax=docker/dockerfile:1

# ---------- 阶段1：构建 Vue 前端 ----------
FROM node:20-alpine AS frontend
WORKDIR /fe
COPY frontend/package.json ./
RUN npm install --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# ---------- 阶段2：安装后端生产依赖 ----------
FROM node:20-alpine AS backend-deps
WORKDIR /be
COPY backend/package.json ./
RUN npm install --omit=dev --no-audit --no-fund

# ---------- 阶段3：运行镜像 ----------
FROM node:20-alpine AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    DB_HOST=db \
    DB_PORT=5432
WORKDIR /app

# 非 root 用户
RUN addgroup -S pet && adduser -S pet -G pet

COPY --from=backend-deps /be/node_modules ./node_modules
COPY backend/package.json ./package.json
COPY backend/src ./src
COPY backend/db ./db
COPY backend/start.sh ./start.sh
COPY --from=frontend /fe/dist ./frontend/dist

RUN chmod +x start.sh && chown -R pet:pet /app
USER pet

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["./start.sh"]
