module.exports = {
  apps: [{
    name: 'solomon-web',
    script: 'npx',
    args: 'next dev -p 3004',
    cwd: '/root/solomon/repo/app',
    autorestart: true,
    max_memory_restart: '800M',
    env: { NODE_ENV: 'development' }
  }]
}
