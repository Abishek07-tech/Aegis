from celery import Celery

from .config import get_settings

celery_app = Celery("risk", broker=get_settings().redis_url, backend=get_settings().redis_url)
