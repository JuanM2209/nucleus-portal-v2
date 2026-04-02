module.exports = {
  apps: [
    {
      name: 'nucleus-backend',
      script: 'packages/backend/dist/main.js',
      cwd: 'Z:/nucleus-portal',
      env: { NODE_ENV: 'production' },
      max_memory_restart: '1G',
      error_file: '~/.pm2/logs/nucleus-backend-error.log',
      out_file: '~/.pm2/logs/nucleus-backend-out.log',
    },
    {
      name: 'nucleus-frontend',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3000',
      cwd: 'Z:/nucleus-portal/packages/frontend',
      env: { NODE_ENV: 'production' },
      max_memory_restart: '512M',
      error_file: '~/.pm2/logs/nucleus-frontend-error.log',
      out_file: '~/.pm2/logs/nucleus-frontend-out.log',
    },
  ],
};
