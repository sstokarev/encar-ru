#!/usr/bin/env python3
"""The architect's one wait loop, with a refusal instead of silent deafness.

Usage: python3 harness/ears.py [--ack <delivery_id>] [--timeout-ms N]

Orca allows exactly ONE actionable waiter per run. Arming a second returns
`ok: false, code: waiter_exists` and exits 0 — so a coordinator that pipes the
output through `tail` believes it is listening while nothing is armed. That
happened on 2026-08-08 during the calculator wave: two `check --wait` calls
overlapped and the second was dead on arrival.

This wrapper prints ONE line per outcome and exits nonzero on any refusal, so
a dead ear can never look like a quiet one:

  EARS: waiting (timeout 570s)      - armed, blocking
  EARS: <type> <id> | <subject>     - one line per delivered message
  EARS: TIMEOUT - checkpoint, worker silence is not failure
  EARS: REFUSED <code> - <message>  - exit 1, nothing is listening
"""
import json
import subprocess
import sys


def run(args):
    r = subprocess.run(["orca", "orchestration", "check"] + args,
                       capture_output=True, text=True)
    body = (r.stdout or "").strip()
    start = body.rfind("\n{")
    if start != -1:
        body = body[start + 1:]
    try:
        return json.loads(body.lstrip("﻿"))
    except Exception:
        print("EARS: REFUSED unparseable - %s" % (body[:200] or r.stderr[:200]))
        sys.exit(1)


def main(argv):
    ack, timeout = None, "570000"
    i = 0
    while i < len(argv):
        if argv[i] == "--ack":
            ack = argv[i + 1]; i += 2
        elif argv[i] == "--timeout-ms":
            timeout = argv[i + 1]; i += 2
        else:
            print("EARS: REFUSED bad-argument - %s" % argv[i]); sys.exit(1)

    args = ["--wait", "--types", "worker_done,question,escalation",
            "--timeout-ms", timeout, "--json"]
    if ack:
        args = ["--ack", ack] + args
    print("EARS: waiting (timeout %ss)" % (int(timeout) // 1000), flush=True)

    d = run(args)
    if not d.get("ok"):
        err = d.get("error") or {}
        print("EARS: REFUSED %s - %s" % (err.get("code"), err.get("message")))
        sys.exit(1)

    result = d.get("result") or {}
    if result.get("timedOut"):
        print("EARS: TIMEOUT - checkpoint, worker silence is not failure")
        return 0

    print("EARS: delivery %s" % result.get("deliveryId"))
    for m in result.get("messages") or []:
        print("EARS: %s %s | %s" % (m.get("type"), m.get("id"),
                                    (m.get("subject") or "")[:70]))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
