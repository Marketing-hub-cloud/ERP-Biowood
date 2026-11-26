# Production image (ดู docs/DEPLOY.md)
#   target "runner" = แอป (Next.js standalone, ขนาดเล็ก, รันด้วย user ไม่ใช่ root)
#   target "tools"  = migrate / seed / import ข้อมูลเก่า (มี node_modules ครบ + source)
# build: docker compose -f docker-compose.prod.yml build

FROM node:24-alpine AS base
ENV TZ=Asia/Bangkok NEXT_TELEMETRY_DISABLED=1
RUN apk add --no-cache tzdata
WORKDIR /app

# ── dependencies (postinstall = prisma generate) ──
FROM base AS deps
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci

# ── build ──
FROM deps AS builder
COPY . .
RUN npm run build

# ── tools: prisma migrate deploy / db:seed / import ──
FROM deps AS tools
COPY . .
CMD ["npx", "prisma", "migrate", "deploy"]

# ── runner ──
FROM base AS runner
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 UPLOAD_DIR=/data/uploads
RUN addgroup -S -g 1001 nodejs && adduser -S -u 1001 -G nodejs nextjs \
  && mkdir -p /data/uploads && chown -R nextjs:nodejs /data
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
