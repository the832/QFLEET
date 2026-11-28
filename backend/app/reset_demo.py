"""Reset the Supply Network to a fresh demo state (drops and recreates the inventory tables).

    cd backend && .venv/bin/python -m app.reset_demo
Restart the server afterwards.
"""
from .db import DB_KIND, Base, engine
from . import inventory

if __name__ == "__main__":
    Base.metadata.drop_all(engine)
    inventory.seed_if_empty()
    print(f"Supply Network reset on {DB_KIND}: 2 demo organisations seeded.")
