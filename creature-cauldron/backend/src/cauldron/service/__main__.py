"""``python -m cauldron.service``: starts the server with uvicorn. Binds to this computer only unless told otherwise."""

import argparse
import os

import uvicorn


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the Creature Cauldron service.")
    parser.add_argument("--host", default=os.environ.get("CAULDRON_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("CAULDRON_PORT", "8000")))
    args = parser.parse_args()
    uvicorn.run("cauldron.service.main:create_default_app", factory=True, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
