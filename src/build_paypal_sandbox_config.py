"""Materialize an isolated Sandbox config, even outside the repository."""

import argparse
import json
from pathlib import Path
import tomllib
from uuid import UUID

PRODUCTION_D1_ID = "802379c7-97cf-4262-93b8-da81c5c3c07d"
ROOT = Path(__file__).resolve().parents[1]


def build_config(database_id):
    database_id = str(UUID(database_id))
    if database_id == PRODUCTION_D1_ID:
        raise ValueError("Sandbox must not use production D1")
    config = tomllib.loads((ROOT / "wrangler.paypal-sandbox.example.toml").read_text())
    config["main"] = str((ROOT / config["main"]).resolve())
    config["assets"]["directory"] = str((ROOT / config["assets"]["directory"]).resolve())
    config["d1_databases"][0]["database_id"] = database_id
    return config


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database-id", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    # Validate before writing: invalid inputs never produce a deployable config.
    config = build_config(args.database_id)
    args.output.write_text(json.dumps(config, indent=2) + "\n")
