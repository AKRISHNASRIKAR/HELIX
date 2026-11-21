# Generic Dockerfile for every FastAPI service (agent-runtime, analytics-engine,
# context-engine, ingestion-service, a2a-gateway). Build context is the repo
# root; SERVICE_PATH selects which service to build (see docker-compose.yml).
#
# The service keeps its real path under /repo because requirements.txt
# installs sibling packages with relative editable paths
# (-e ../../packages/contracts-py, -e ../../analytics/..., -e ../../agents/...).
FROM python:3.12-slim
ARG SERVICE_PATH
ARG SERVICE_PORT=8000
ENV SERVICE_PORT=${SERVICE_PORT}

WORKDIR /repo
COPY packages/contracts-py ./packages/contracts-py
COPY analytics ./analytics
COPY agents ./agents
COPY ${SERVICE_PATH} ./${SERVICE_PATH}

WORKDIR /repo/${SERVICE_PATH}
RUN pip install --no-cache-dir -r requirements.txt

EXPOSE ${SERVICE_PORT}
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${SERVICE_PORT}"]
