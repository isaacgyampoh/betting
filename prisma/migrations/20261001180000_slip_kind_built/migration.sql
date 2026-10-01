-- A slip the assistant builds from today's fixtures is none of the existing kinds: it was not
-- loaded from a code, converted from another slip, or produced by editing one.
ALTER TYPE "SlipKind" ADD VALUE IF NOT EXISTS 'BUILT';
