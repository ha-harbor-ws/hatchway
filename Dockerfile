# Hatchway: FastAPI + SQLite + файлы в volume
FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Pillow: колёса обычно подходят; при проблемах с форматами добавьте пакеты из Debian
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libjpeg62-turbo \
        zlib1g \
        libwebp7 \
    && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --uid 1000 hatchway

COPY requirements.txt .
RUN pip install --upgrade pip \
    && pip install -r requirements.txt

COPY app ./app
COPY templates ./templates
COPY static ./static
COPY docker-entrypoint.sh /docker-entrypoint.sh

RUN mkdir -p data uploads \
    && chown -R hatchway:hatchway /app \
    && chmod +x /docker-entrypoint.sh

EXPOSE 8000

# Запуск от root только для chown томов; процесс uvicorn — пользователь hatchway
ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
