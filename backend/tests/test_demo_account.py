from types import SimpleNamespace

from sqlalchemy import delete, select

from app.db import SessionLocal
from app.models import User
from app.security import ensure_demo_account, verify_password


def demo_settings(enabled: bool = True):
    return SimpleNamespace(
        enable_demo_account=enabled,
        demo_user_email="demo@brand.local",
        demo_user_password="BrandDemo@2026!",
    )


def test_demo_account_is_created_with_argon2_hash_and_is_idempotent():
    with SessionLocal() as db:
        db.execute(delete(User).where(User.username == "demo@brand.local"))
        db.commit()
        assert ensure_demo_account(db, demo_settings()) is True
        user = db.scalar(select(User).where(User.username == "demo@brand.local"))
        assert user is not None
        first_hash = user.password_hash
        assert first_hash.startswith("$argon2")
        assert user.password_hash != "BrandDemo@2026!"
        assert verify_password("BrandDemo@2026!", user.password_hash)
        assert ensure_demo_account(db, demo_settings()) is False
        db.refresh(user)
        assert user.password_hash == first_hash


def test_demo_account_can_be_disabled_and_existing_users_are_untouched():
    with SessionLocal() as db:
        db.execute(delete(User).where(User.username.in_(["demo@brand.local", "existing-user"])))
        existing = User(username="existing-user", password_hash="$argon2id$v=19$m=65536,t=3,p=4$placeholder")
        db.add(existing)
        db.commit()
        assert ensure_demo_account(db, demo_settings(enabled=False)) is False
        assert db.scalar(select(User).where(User.username == "demo@brand.local")) is None
        assert db.scalar(select(User).where(User.username == "existing-user")) is not None
