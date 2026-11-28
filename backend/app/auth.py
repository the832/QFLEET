"""Sign-in with Neon Auth (managed Better Auth).

The browser signs in against NEON_AUTH_URL and sends the session JWT as a Bearer token.
We verify it with the project's JWKS (EdDSA / Ed25519); issuer and audience are the origin
of the auth URL. Without NEON_AUTH_URL the API runs in open demo mode.
"""
from __future__ import annotations

import os
from urllib.parse import urlsplit

import jwt
from fastapi import Header, HTTPException

from . import db as _db  # noqa: F401  (loads backend/.env)

AUTH_URL = os.environ.get("NEON_AUTH_URL", "").strip().rstrip("/")
_parts = urlsplit(AUTH_URL) if AUTH_URL else None
ORIGIN = f"{_parts.scheme}://{_parts.netloc}" if _parts else ""
_jwks = jwt.PyJWKClient(f"{AUTH_URL}/.well-known/jwks.json", cache_keys=True, lifespan=3600) if AUTH_URL else None

DEMO_USER = {"id": "demo", "email": None, "name": "Demo operator", "demo": True}


def verify(token: str) -> dict:
    key = _jwks.get_signing_key_from_jwt(token)  # refetches the JWKS when the kid is unknown
    claims = jwt.decode(token, key.key, algorithms=["EdDSA"], issuer=ORIGIN, audience=ORIGIN,
                        options={"require": ["exp", "sub"]})
    if claims.get("banned"):
        raise jwt.InvalidTokenError("user is banned")
    return {"id": claims["sub"], "email": claims.get("email"), "name": claims.get("name") or claims.get("email"),
            "demo": False}


def current_user(authorization: str | None = Header(default=None)) -> dict:
    if not AUTH_URL:
        return DEMO_USER
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Sign in required")
    try:
        return verify(authorization.split(" ", 1)[1].strip())
    except jwt.PyJWTError as exc:
        raise HTTPException(401, f"Invalid session: {exc}")
