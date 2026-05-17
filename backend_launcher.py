import uvicorn

from backend import config


if __name__ == "__main__":
    uvicorn.run(
        "backend.main:app",
        host=config.APP_HOST,
        port=config.APP_PORT,
        log_level="info",
    )
