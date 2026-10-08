from datetime import datetime, timedelta, timezone

import jwt
from argon2 import PasswordHasher
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import get_settings
from .db import get_db
from .models import User

password_hasher = PasswordHasher()
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")


def hash_password(password: str) -> str:
    return password_hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return password_hasher.verify(password_hash, password)
    except Exception:
        return False


def ensure_demo_account(db: Session, settings) -> bool:
    """Create the configured local demo user once, without changing existing users."""
    if not settings.enable_demo_account:
        return False
    if not settings.demo_user_email or not settings.demo_user_password:
        raise RuntimeError("Demo account is enabled but demo credentials are incomplete")
    existing = db.scalar(select(User).where(User.username == settings.demo_user_email))
    if existing is not None:
        return False
    db.add(User(
        username=settings.demo_user_email,
        password_hash=hash_password(settings.demo_user_password),
    ))
    db.commit()
    return True


def create_access_token(user_id: str) -> str:
    settings = get_settings()
    expires = datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_expire_minutes)
    return jwt.encode({"sub": user_id, "exp": expires}, settings.jwt_secret, algorithm="HS256")


def current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> User:
    credentials_error = HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid authentication credentials")
    try:
        payload = jwt.decode(token, get_settings().jwt_secret, algorithms=["HS256"])
        user_id = payload.get("sub")
    except jwt.PyJWTError as exc:
        raise credentials_error from exc
    user = db.get(User, user_id)
    if user is None:
        raise credentials_error
    return user
