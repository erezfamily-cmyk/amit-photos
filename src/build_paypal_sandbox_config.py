"""Materialize an isolated Sandbox config, even outside the repository."""

import argparse
from copy import deepcopy
import json
from pathlib import Path
import tomllib
from uuid import UUID

PRODUCTION_D1_ID = "802379c7-97cf-4262-93b8-da81c5c3c07d"
ROOT = Path(__file__).resolve().parents[1]


def build_config(database_id, preview=False):
    database_id = str(UUID(database_id))
    if database_id == PRODUCTION_D1_ID:
        raise ValueError("Sandbox must not use production D1")
    config = tomllib.loads((ROOT / "wrangler.paypal-sandbox.example.toml").read_text())
    config["main"] = str((ROOT / config["main"]).resolve())
    config["assets"]["directory"] = str((ROOT / config["assets"]["directory"]).resolve())
    config["d1_databases"][0]["database_id"] = database_id
    if preview:
        # Native Previews do not inherit storage bindings or vars.
        # Retain test resources explicitly and keep public checkout closed.
        config["previews"] = {
            # Cleanup stays admin-authenticated and dry-run by default; it only
            # exists in this Sandbox-only helper, never in the production config.
            "vars": {"PAYMENTS_ENABLED": "false", "PAYPAL_SANDBOX_CLEANUP_ENABLED": "true"},
            "d1_databases": deepcopy(config["d1_databases"]),
            "r2_buckets": deepcopy(config["r2_buckets"]),
            "images": deepcopy(config["images"]),
            # The experience-photo endpoint reads only the production Worker's
            # already-public photo API. Its hostname guard keeps this path
            # available only from the Sandbox Preview.
            "services": [
                {"binding": "PUBLIC_GALLERY_SERVICE", "service": "amit-photos"},
            ],
        }
    return config


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database-id", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--preview", action="store_true")
    args = parser.parse_args()
    # Validate before writing: invalid inputs never produce a deployable config.
    config = build_config(args.database_id, preview=args.preview)
    args.output.write_text(json.dumps(config, indent=2) + "\n")
