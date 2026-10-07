# Stage 1: Build Frontend
FROM node:20-alpine AS frontend-builder
ARG BUILD_VERSION=dev
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
# Expose the build version to Vite so it is baked into the bundle.
ENV VITE_APP_VERSION=$BUILD_VERSION
RUN npm run build

# Stage 2: Backend
FROM python:3.11-slim
ARG BUILD_VERSION=dev
ENV BUILD_VERSION=$BUILD_VERSION
WORKDIR /app

# Install dependencies
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend code
COPY backend/ ./backend/

# Copy built frontend
COPY --from=frontend-builder /app/frontend/dist ./static

# Update main.py to serve static files if needed, or just rely on Caddy/Proxy
# For now, we assume the proxy handles serving static files or we mount them.
# Actually, let's keep it simple: FastAPI serves API, Caddy serves Static.

EXPOSE 8000

CMD ["uvicorn", "backend.main:starlette_app", "--host", "0.0.0.0", "--port", "8000"]
