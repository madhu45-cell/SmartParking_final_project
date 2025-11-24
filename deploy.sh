#!/bin/bash

echo "🚀 Starting SmartParking Deployment..."

# Stop and remove existing containers
docker-compose down

# Remove existing images to force rebuild
docker rmi final_madhu_backend final_madhu_frontend 2>/dev/null || true

# Build and start services
docker-compose up --build -d

echo "⏳ Waiting for services to start..."
sleep 15

# Check service status
echo "📊 Service Status:"
docker-compose ps

echo "🔍 Checking backend logs..."
docker-compose logs backend

echo "🌐 Your application should be available at:"
echo "   Frontend: http://localhost:3000"
echo "   Backend:  http://localhost:8000"
echo "   Database: localhost:3306"

echo "✅ Deployment completed!"