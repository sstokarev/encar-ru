#!/usr/bin/env python3
"""Send a worker message whose body survives the trip, or refuse loudly.

Usage:
  python3 harness/say.py --to dispatch:<id> --subject "..." --body-file <path>
  python3 harness/say.py --reply <msg_id>   --body-file <path>

Two silent corruptions this closes, both measured on 2026-08-08:

 1. `orca orchestration send --body "...`code`..."` runs through a shell, and
    backticks are command substitution: a message telling a worker which line
    to change arrived as "which today reads ." - valid, delivered, and wrong.
    Bodies here are read from a FILE and passed as an argv list, never a
    shell string.
 2. The `ask` return value truncates near 2,015 chars (spike-native-dispatch).
    After sending, this reads the stored copy back from the inbox and compares
    it byte for byte with what was intended.

Exit 0 prints `SAY: OK <msg_id> (<n> chars verified)`. Any mismatch or send
failure prints `SAY: REFUSED ...` and exits 1 - a mangled instruction to a
worker is worse than no instruction, because the worker acts on it.
"""
import json
import subprocess
import sys
from pathlib import Path


def orca(args):
    r = subprocess.run(["orca", "orchestration"] + args,
                       capture_output=True, text=True)
    out = (r.stdout or "").strip()
    try:
        return json.loads(out.lstrip("﻿"))
    except Exception:
        print("SAY: REFUSED unparseable-response - %s" % (out[:160] or r.stderr[:160]))
        sys.exit(1)


def sent_body(msg_id):
    """The authoritative stored copy (inbox is lossless; returns are not)."""
    d = orca(["inbox", "--json"])
    for m in (d.get("result") or {}).get("messages") or []:
        if m.get("id") == msg_id:
            return m.get("body")
    return None


def main(argv):
    to = subject = reply_to = body_file = None
    i = 0
    while i < len(argv):
        k = argv[i]
        if k in ("--to", "--subject", "--reply", "--body-file"):
            if i + 1 >= len(argv):
                print("SAY: REFUSED missing-value - %s" % k); sys.exit(1)
            v = argv[i + 1]
            to, subject, reply_to, body_file = (
                (v, subject, reply_to, body_file) if k == "--to" else
                (to, v, reply_to, body_file) if k == "--subject" else
                (to, subject, v, body_file) if k == "--reply" else
                (to, subject, reply_to, v))
            i += 2
        else:
            print("SAY: REFUSED bad-argument - %s" % k); sys.exit(1)

    if not body_file:
        print("SAY: REFUSED no-body-file - bodies are files, never shell strings")
        sys.exit(1)
    body = Path(body_file).read_text(encoding="utf-8")
    if not body.strip():
        print("SAY: REFUSED empty-body"); sys.exit(1)

    if reply_to:
        args = ["reply", "--id", reply_to, "--body", body, "--json"]
    elif to and subject:
        args = ["send", "--to", to, "--subject", subject, "--body", body, "--json"]
    else:
        print("SAY: REFUSED need --reply or (--to and --subject)"); sys.exit(1)

    d = orca(args + [])
    if not d.get("ok"):
        err = d.get("error") or {}
        print("SAY: REFUSED %s - %s" % (err.get("code"), err.get("message")))
        sys.exit(1)

    msg = ((d.get("result") or {}).get("message") or {})
    msg_id = msg.get("id")
    stored = sent_body(msg_id) if msg_id else None
    if stored is None:
        print("SAY: REFUSED not-in-inbox - sent %s but cannot verify the body" % msg_id)
        sys.exit(1)
    if stored != body:
        print("SAY: REFUSED corrupted - intended %d chars, stored %d" %
              (len(body), len(stored)))
        for n, (a, b) in enumerate(zip(body, stored)):
            if a != b:
                print("SAY: first difference at char %d: %r vs %r" % (n, a, b))
                break
        sys.exit(1)

    print("SAY: OK %s (%d chars verified)" % (msg_id, len(body)))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
