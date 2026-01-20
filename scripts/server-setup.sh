#!/bin/bash
# Server Setup Script for chs-spots
# Run this on your Ubuntu server as the deploy user
# This script sets up the initial directory structure and PM2

set -e

echo "🚀 Setting up chs-spots production environment..."

# Configuration
APP_DIR="/opt/chs-spots"
USER="deploy"  # Change if using different user

# Create directory structure
echo "📁 Creating directory structure..."
sudo mkdir -p "$APP_DIR"/{app,data/{raw,all,incremental,previous},silver_merged/{all,incremental},silver_trimmed/{all,incremental,previous},gold,reporting,logs},backups
sudo chown -R $USER:$USER "$APP_DIR"

# Create log directories
mkdir -p "$APP_DIR/data/logs"

# Set permissions
echo "🔐 Setting permissions..."
chmod 755 "$APP_DIR"
chmod 755 "$APP_DIR/app"
chmod 755 "$APP_DIR/data"
chmod 755 "$APP_DIR/backups"

# Create .env file template if it doesn't exist
if [ ! -f "$APP_DIR/.env" ]; then
    echo "📝 Creating .env template..."
    cat > "$APP_DIR/.env" << EOF
# Production Environment Variables
NODE_ENV=production
PORT=3000

# Google Maps API Key
NEXT_PUBLIC_GOOGLE_MAPS_KEY=your_key_here

# Grok API Key (for LLM extraction)
GROK_API_KEY=your_key_here
EOF
    chmod 600 "$APP_DIR/.env"
    echo "⚠️  Please edit $APP_DIR/.env with your actual API keys"
fi

# Install PM2 if not already installed
if ! command -v pm2 &> /dev/null; then
    echo "📦 Installing PM2..."
    npm install -g pm2
fi

# Copy PM2 config if it doesn't exist
if [ ! -f "$APP_DIR/pm2.config.js" ]; then
    echo "📋 Creating PM2 config..."
    # Note: You'll need to copy pm2.config.js manually or create it
    echo "⚠️  Please copy pm2.config.js to $APP_DIR/pm2.config.js"
fi

echo "✅ Server setup completed!"
echo ""
echo "Next steps:"
echo "1. Edit $APP_DIR/.env with your API keys"
echo "2. Copy pm2.config.js to $APP_DIR/pm2.config.js"
echo "3. Configure Nginx (see nginx.conf example)"
echo "4. Run first deployment via GitHub Actions"
