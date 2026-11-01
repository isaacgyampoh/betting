#!/usr/bin/env python3
"""Static validation of the deployment configuration.

Checks the things that are cheap to get wrong and expensive to discover on a cutover: a
depends_on pointing at nothing, a bind mount whose source does not exist, Postgres accidentally
publishing a port, a service with no memory ceiling, a variable used but never documented.

Runs without Docker, so it is useful on a laptop before the VPS exists. It is NOT a substitute for
`docker compose config` and `docker build`, which are the only things that prove the stack really
builds; preflight.sh runs those when Docker is present.

    python3 scripts/validate-config.py
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
FAILURES: list[str] = []


def ok(msg: str) -> None:
    print(f"  ok    {msg}")


def bad(msg: str) -> None:
    print(f"  FAIL  {msg}")
    FAILURES.append(msg)


def load_compose() -> dict:
    """js-yaml via npx, because PyYAML is not a dependency of this project."""
    out = subprocess.run(
        ["npx", "--yes", "js-yaml@4.1.0", str(HERE / "docker-compose.yml")],
        capture_output=True, text=True, cwd=HERE,
    )
    if out.returncode != 0:
        bad(f"docker-compose.yml does not parse: {out.stderr.strip()[:200]}")
        sys.exit(1)
    return json.loads(out.stdout)


def main() -> int:
    compose = load_compose()
    raw = (HERE / "docker-compose.yml").read_text()
    services = compose.get("services", {})
    networks = compose.get("networks", {})
    volumes = compose.get("volumes", {})

    print("== structure ==")
    ok(f"parses; project '{compose.get('name')}', services: {', '.join(services)}")
    for name, svc in services.items():
        for dep in svc.get("depends_on") or {}:
            if dep not in services:
                bad(f"{name}.depends_on -> '{dep}' is not a service")
        for net in svc.get("networks") or []:
            if net not in networks:
                bad(f"{name} uses undeclared network '{net}'")
        for vol in svc.get("volumes") or []:
            src = vol.split(":")[0]
            if src.startswith("./"):
                if not (HERE / src[2:]).exists():
                    bad(f"{name} bind-mounts missing path {src}")
            elif not src.startswith("/") and src not in volumes:
                bad(f"{name} uses undeclared volume '{src}'")
        build = svc.get("build")
        if isinstance(build, dict) and build.get("dockerfile"):
            ctx = (HERE / build.get("context", ".")).resolve()
            if not (ctx / build["dockerfile"]).exists() and not (HERE / build["dockerfile"]).exists():
                bad(f"{name}: {build['dockerfile']} not found")

    print("\n== the database is not reachable from outside ==")
    db = services.get("db", {})
    if db.get("ports"):
        bad(f"db publishes {db['ports']} - the entire reason for this migration was to stop that")
    else:
        ok("db declares no published ports")
    if networks.get("data", {}).get("internal") is True:
        ok("'data' network is internal, so it has no route off the host")
    else:
        bad("'data' network is not marked internal")
    if set(db.get("networks") or []) == {"data"}:
        ok("db is attached only to the internal network")
    else:
        bad(f"db networks are {db.get('networks')}, expected only ['data']")

    print("\n== resource ceilings, so one project cannot starve another ==")
    for name, svc in services.items():
        if svc.get("cpus") and svc.get("mem_limit"):
            ok(f"{name}: {svc['cpus']} cpu, {svc['mem_limit']}")
        else:
            bad(f"{name} has no cpu and/or memory ceiling")

    print("\n== variables ==")
    # `$${VAR}` is escaped: compose passes a literal ${VAR} through for the container's own shell
    # to expand (the db healthcheck does this, where POSTGRES_USER is set by the postgres image).
    # Matching those as compose-level variables is wrong, so they are removed first.
    host_level = re.sub(r"\$\$\{[A-Z0-9_]+\}", "", raw)
    used = set(re.findall(r"(?<!\$)\$\{([A-Z0-9_]+)", host_level))
    with_default = set(re.findall(r"(?<!\$)\$\{([A-Z0-9_]+):-", host_level))
    documented = set(re.findall(r"^([A-Z0-9_]+)=", (HERE / ".env.example").read_text(), re.M))
    missing = sorted(used - documented - with_default)
    if missing:
        bad(f"used by compose but absent from .env.example: {', '.join(missing)}")
    else:
        ok(f"all {len(used)} compose variables documented ({len(with_default)} have defaults)")
    required_marker = sorted(re.findall(r"(?<!\$)\$\{([A-Z0-9_]+):\?", host_level))
    ok(f"{len(required_marker)} variables fail the stack fast if unset: {', '.join(required_marker[:6])}…")

    print("\n== Dockerfile ==")
    dockerfile = (HERE / "Dockerfile").read_text()
    stages = set(re.findall(r"^FROM\s+\S+\s+AS\s+(\S+)", dockerfile, re.M | re.I))
    ok(f"stages: {', '.join(sorted(stages))}")
    for name, svc in services.items():
        build = svc.get("build")
        target = build.get("target") if isinstance(build, dict) else None
        if target and target not in stages:
            bad(f"{name} targets stage '{target}' which does not exist")
        elif target:
            ok(f"{name} -> stage '{target}'")
    for frm in sorted(set(re.findall(r"COPY\s+--from=(\w+)", dockerfile))):
        if frm not in stages:
            bad(f"COPY --from={frm} is not a defined stage")
    if "USER nextjs" in dockerfile:
        ok("the serving image drops to a non-root user")
    else:
        bad("the serving image runs as root")
    if "HEALTHCHECK" in dockerfile:
        ok("serving image has a healthcheck")

    print("\n== proxy ==")
    caddy = (HERE / "Caddyfile").read_text()
    upstream = re.search(r"reverse_proxy\s+(\S+)", caddy)
    if upstream:
        host = upstream.group(1).split(":")[0]
        if host in services:
            ok(f"Caddy proxies to '{host}', which is a service")
        else:
            bad(f"Caddy proxies to '{host}', which is not a service in this stack")
    if "admin off" in caddy:
        ok("Caddy's admin API is disabled")
    else:
        bad("Caddy's admin API is not disabled")
    if "-CF-Connecting-IP" in caddy:
        ok("a client-supplied CF-Connecting-IP is stripped (it would defeat IP rate limiting)")

    print("\n== scripts referenced by the stack exist ==")
    for name, svc in services.items():
        for field in ("entrypoint", "command"):
            val = svc.get(field)
            parts = val if isinstance(val, list) else ([val] if isinstance(val, str) else [])
            for part in parts:
                m = re.match(r"^/scripts/(\S+\.sh)$", str(part))
                if m:
                    if (HERE / "scripts" / m.group(1)).exists():
                        ok(f"{name}.{field} -> scripts/{m.group(1)}")
                    else:
                        bad(f"{name}.{field} references missing scripts/{m.group(1)}")

    print()
    if FAILURES:
        print(f"  {len(FAILURES)} FAILURE(S)")
        return 1
    print("  configuration validation passed.")
    print("  Not proven here: that the image builds and the stack starts. That needs Docker;")
    print("  preflight.sh runs `docker compose config` and deploy.sh builds, on the host.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
