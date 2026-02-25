module.exports = {
  apps: [{
    name: 'chs-spots',
    cwd: '/home/ubuntu/projects/chs-spots',
    script: './start.sh',
    interpreter: '/bin/bash',
    max_restarts: 3,
    min_uptime: '10s',
    restart_delay: 5000,
    env: {
      NODE_ENV: 'production',
      DATA_DIR: '/home/ubuntu/data',
      DB_PATH: '/home/ubuntu/data/chs-spots.db',
    },
  }],
};
