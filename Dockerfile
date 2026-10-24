# Trusted fixture container. Build only a candidate after dependency policy passes.
FROM python:3.12-slim-bookworm@sha256:6a0e06f5ba0b373d051aabd3fffb9b873f27f9a2a3a14bcbe37dee6f0e3bbc70
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY wheels/ /wheels/
COPY requirements.txt /app/requirements.txt
RUN pip install --no-index --find-links=/wheels --no-cache-dir -r /app/requirements.txt && rm -rf /wheels
COPY service/ /app/service/
USER 10001:10001
CMD ["python", "-m", "service.client"]
