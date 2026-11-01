# The backup runner: Postgres client tools plus age.
#
# Built rather than using postgres:17-bookworm directly because the dump has to be encrypted on the
# way out, and the base image has no encryption tool that can do public-key encryption. age can:
# the server holds only the public key, so it can write a backup it has no way to read. A VPS that
# gets compromised therefore cannot decrypt its own backup history.
FROM postgres:17-bookworm
RUN apt-get update \
    && apt-get install -y --no-install-recommends age curl \
    && rm -rf /var/lib/apt/lists/*
