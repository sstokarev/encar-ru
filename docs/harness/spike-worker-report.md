# Spike report: native dispatch proof

- **Claim sha:** `a41068ee5cb59c97314fd6768067f33e34e83e66` (`claim: task/spike-native-dispatch`, empty commit)
- **Ask-reply body length:** 2015 chars (from `orca orchestration ask --json`, `answer` field; messageId `msg_67bbc68dfb70`, answerMessageId `msg_5c7febd7d7a2`)
- **Inbox body length:** 2200 chars (same message `msg_5c7febd7d7a2` in `orca orchestration inbox --json`, decoded as `utf-8-sig`)
- **Match:** NO — mismatch of 185 chars.

## Anomaly: ask reply is truncated

The ask-reply body is a **strict prefix** of the inbox body (`inbox_body.startswith(ask_body) == True`). The payload is the repeating 37-char unit `abcdefghijklmnopqrstuvwxyz0123456789-`:

- inbox copy: 59 full units + 17-char tail `abcdefghijklmnopq` = 2200 chars (well-formed, ends exactly like the sender's pattern)
- ask output: cut mid-unit at exactly 2015 chars (54 full units + `abcdefghijklmnopq`), then the JSON continues normally with `messageId`/`threadId`/etc.

So `ask --json` silently truncated the `answer` field to 2015 chars while producing otherwise valid JSON — no truncation marker, no error. The inbox copy is the authoritative full body.

## Other observations

- `inbox --json` output indeed starts with a UTF-8 BOM; `utf-8-sig` decoding required (plain `json.load` on utf-8 would fail on the first key).
- No double prompt, no errors, no timeout (`timedOut: false`, `cancelled: false`, `connectionLost: false`); ask blocked and returned once, as designed.
- Inbox also contains the original question message `msg_67bbc68dfb70` (type `question`, body 16 chars = "Send payload now").

**Conclusion for the harness:** treat the `ask` return value as potentially truncated for large payloads (>~2000 chars); fetch the authoritative body from the inbox by `answerMessageId`.
