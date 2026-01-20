/**
 * PM2 Ecosystem Configuration for chs-spots Production Server
 * 
 * Place this file at: /opt/chs-spots/pm2.config.js
 * 
 * Start with: pm2 start pm2.config.js
 * Save PM2 config: pm2 save
 * Setup startup script: pm2 startup systemd
 */

module.exports = {
  apps: [{
    name: 'chs-spots',
    script: 'npm',
    args: 'start',
    cwd: '/opt/chs-spots/app',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      PORT: 3000,
    },
    env_file: '/opt/chs-spots/.env',
    error_file: '/opt/chs-spots/data/logs/pm2-error.log',
    out_file: '/opt/chs-spots/data/logs/pm2-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    // Health check (optional)
    // health_check_grace_period: 3000,
  }]
};
