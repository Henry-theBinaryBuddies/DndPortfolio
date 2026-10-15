# Chronomancer: the website, the Discord bot and the background loop run as one process.
FROM python:3.15-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /srv/app

# The exact versions the test suite passed with (not the loose ranges in requirements.txt).
COPY requirements.lock.txt .
RUN pip install --prefer-binary -r requirements.lock.txt

COPY alembic.ini ./
COPY migrations ./migrations
COPY app ./app
COPY web ./web

# Run as an ordinary user. /data holds the SQLite file and is mounted from the host.
RUN useradd --system --uid 10001 --no-create-home chronomancer \
    && mkdir /data && chown chronomancer /data
USER chronomancer

ENV DATABASE_URL=sqlite:////data/chronomancer.db
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/config', timeout=4)"

# --proxy-headers: the real visitor address (for rate limiting) comes from the proxy in front.
# The port is never published to the internet, only the proxy container can reach it.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", \
     "--proxy-headers", "--forwarded-allow-ips", "*"]
