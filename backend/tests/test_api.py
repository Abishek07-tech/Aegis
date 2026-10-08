import os
from io import BytesIO
from pathlib import Path

os.environ["DATABASE_URL"] = "sqlite:///./test-risk.db"
os.environ["JWT_SECRET"] = "test-secret"
Path("test-risk.db").unlink(missing_ok=True)

from fastapi.testclient import TestClient
from PIL import Image

from app.main import app


def test_register_login_and_isolation():
    with TestClient(app) as client:
        response = client.post("/auth/register", json={"username": "analyst", "password": "correct horse battery"})
        assert response.status_code == 201
        token = response.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}
        created = client.post("/investigations", headers=headers, json={"company_name": "Example"})
        assert created.status_code == 201
        assert client.get("/investigations", headers=headers).json()[0]["company_name"] == "Example"


def test_auth_required():
    with TestClient(app) as client:
        assert client.get("/investigations").status_code == 401


def test_official_inputs_and_logo_are_owned_and_provenanced():
    image = Image.new("RGB", (32, 32), "white")
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    png = buffer.getvalue()
    with TestClient(app) as client:
        first = client.post("/auth/register", json={"username": "asset-owner", "password": "correct horse battery"})
        token = first.json()["access_token"]
        headers = {"Authorization": "".join(["Bearer", " ", token])}
        created = client.post("/investigations", headers=headers, json={
            "company_name": "Acme",
            "official_website": "https://example.com",
            "official_instagram": "https://instagram.com/acme",
            "official_linkedin": "https://linkedin.com/company/acme",
            "official_apps": [{"app_name": "Acme", "store_url": "https://play.google.com/store/apps/details?id=com.acme"}],
            "other_official_information": "Untrusted analyst context",
        })
        assert created.status_code == 201
        investigation_id = created.json()["id"]
        assets = client.get(f"/investigations/{investigation_id}/assets", headers=headers)
        assert assets.status_code == 200
        assert {asset["source"] for asset in assets.json()} == {"user_supplied"}
        assert all(asset["verification_status"] == "PENDING" for asset in assets.json())
        uploaded = client.post(
            f"/investigations/{investigation_id}/logo",
            headers=headers,
            files={"logo": ("logo.png", png, "image/png")},
        )
        assert uploaded.status_code == 201
        assert "storage_name" not in uploaded.json()["metadata_json"]
        other = client.post("/auth/register", json={"username": "asset-other", "password": "correct horse battery"})
        assert client.get(
            f"/investigations/{investigation_id}/assets",
            headers={"Authorization": "".join(["Bearer", " ", other.json()["access_token"]])},
        ).status_code == 404
        assert client.post("/investigations", headers=headers, json={
            "company_name": "Acme",
            "official_instagram": "http://127.0.0.1/acme",
        }).status_code == 422
