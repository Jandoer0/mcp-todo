# ---- Stage 1: build the frontend ----
FROM node:20-alpine AS frontend-builder
ARG BUILD_VERSION=dev
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
# Bake the build version into the bundle so the app can detect stale deployments.
ENV VITE_APP_VERSION=$BUILD_VERSION
RUN npm run build

# ---- Stage 2: backend ----
FROM python:3.11-slim
ARG BUILD_VERSION=dev
ENV BUILD_VERSION=$BUILD_VERSION
WORKDIR /app

COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ ./backend/
COPY --from=frontend-builder /app/frontend/dist ./static

EXPOSE 8000
CMD ["uvicorn", "backend.app.main:starlette_app", "--host", "0.0.0.0", "--port", "8000"]
