# cdek-proxy

Обычный Node.js/Fastify backend для CDEK API, который используется `tg-miniapp-shop`.

## Стек
- Node.js 20+
- Fastify
- Axios
- dotenv
- pino
- PM2

## Установка
```bash
npm install
cp .env.example .env
```

Заполните `.env` ключами CDEK для профилей `MSK` и `YAN`.

## Локальный запуск
```bash
npm run dev
```

## Сборка
```bash
npm run build
```

## Продакшен-запуск
```bash
npm run start
```

## PM2
```bash
pm2 start dist/server.js --name cdek-proxy
```

## API
- `GET /api/health`
- `GET /api/cities?q=...`
- `GET /api/pvz?cityCode=...`
- `POST /api/shipping/quote`
- `POST /api/shipping/create`
- `GET /api/shipping/status/:uuid?originProfile=MSK|YAN`
