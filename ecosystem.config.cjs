module.exports = {
  apps: [
    {
      name: 'chs-spots',
      cwd: '/home/ubuntu/projects/chs-spots',
      script: './start.sh',
      interpreter: '/bin/bash',
      max_restarts: 3,
      min_uptime: '10s',
      restart_delay: 5000,
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'chs-admin',
      cwd: '/home/ubuntu/projects/chs-spots',
      script: 'scripts/serve-admin.js',
      max_restarts: 3,
      min_uptime: '5s',
      restart_delay: 3000,
      env: {
        NODE_ENV: 'production',
        ADMIN_PORT: '3456',
        ADMIN_BIND: '0.0.0.0',
      },
    },
  ],
};
