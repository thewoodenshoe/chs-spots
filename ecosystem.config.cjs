module.exports = {
  apps: [{
    name: 'chs-spots',
    cwd: '/home/ubuntu/projects/chs-spots',
    script: 'node_modules/.bin/next',
    args: 'start',
    max_restarts: 3,
    min_uptime: '10s',
    restart_delay: 5000,
    env: {
      NODE_ENV: 'production',
      DATA_DIR: '/home/ubuntu/projects/chs-spots/data',
    },
  }],
};
