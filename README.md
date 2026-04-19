# Hatchway

Веб-приложение на FastAPI: учёт колодцев по паре фотографий (люк + панорама) с проверкой GPS в EXIF, вход по табельному номеру и фамилии, рейтинг по числу загруженных люков.

## Быстрый старт (без Docker)

```bash
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

## Docker (Linux-сервер)

1. Установите [Docker](https://docs.docker.com/engine/install/) и [Compose plugin](https://docs.docker.com/compose/install/).
2. Склонируйте репозиторий и перейдите в каталог проекта.
3. Создайте файл `.env` из примера и задайте секрет:

   ```bash
   cp .env.example .env
   # Отредактируйте .env: SESSION_SECRET — длинная случайная строка
   ```

4. Сборка и запуск:

   ```bash
   docker compose up -d --build
   ```

5. Сайт: `http://<IP-сервера>:8000` (порт меняется через `HATCHWAY_PORT` в `.env`).

Данные SQLite и загрузки хранятся в именованных томах Docker (`hatchway_data`, `hatchway_uploads`).

### Переменные окружения

| Переменная       | Описание                                      |
|------------------|-----------------------------------------------|
| `SESSION_SECRET` | Секрет подписи cookie-сессий (обязательно)    |
| `HATCHWAY_PORT`  | Порт на хосте (по умолчанию `8000`)          |
| `MAX_UPLOAD_MB`  | Максимальный размер одного файла (МБ)        |

Перед продакшеном смените `SESSION_SECRET` и при необходимости поставьте reverse proxy (nginx, Caddy) с HTTPS.

### Ошибка 503 у прокси

Чаще всего **бэкенд не запущен или падает в цикле перезапусков**. Проверьте логи:

```bash
docker compose logs -f web
```

Типичная причина на Linux — **нет прав на запись** в тома `/app/data` и `/app/uploads` (SQLite и файлы). В образе это обходится через `docker-entrypoint.sh` (chown под root перед запуском uvicorn от пользователя `hatchway`). После обновления образа выполните `docker compose up -d --build`.

Проверка из контейнера: ответ `200` у `GET /health` (например `curl -s http://127.0.0.1:8000/health` с хоста на проброшенный порт).
