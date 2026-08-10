/**
 * PM2 process definitions for VPS deployment (see docs/DEPLOYMENT-VPS.md).
 * Start with:  pm2 start ecosystem.config.cjs
 * Boot-time:   pm2 save && pm2 startup   (then run the command PM2 prints)
 * Logs:        pm2 logs
 */
module.exports = {
  apps: [
    {
      name: 'algo-backend',
      script: 'backend/dist/index.js',
      instances: 1,
      autorestart: true,
      max_restarts: 20,
      restart_delay: 3000,
      env: { NODE_ENV: 'production' },
    },
    {
      name: 'algo-worker',
      script: 'backend/dist/worker.js',
      instances: 1,
      autorestart: true,
      max_restarts: 20,
      restart_delay: 3000,
      env: { NODE_ENV: 'production' },
    },
    {
      name: 'algo-frontend',
      script: 'npx',
      interpreter: 'none',
      args: ['vite', 'preview', '--host', '0.0.0.0', '--port', '5173'],
      cwd: './frontend',
      autorestart: true,
      max_restarts: 20,
      restart_delay: 3000,
    },
  ],
}
