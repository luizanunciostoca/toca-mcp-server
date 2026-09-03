from pathlib import Path

src = Path('.github/workflows/instagram-engagement-controlled-write-canary-v2.yml').read_text()
src = src.replace(
    '      - name: Release pending canary reservations\n        if:',
    '      - name: Release pending canary reservations\n        id: reservation_cleanup\n        if:',
    1,
)
src = src.replace(
    '      - name: Restore persistent daemon to runtime-on and writes-off\n        if:',
    '      - name: Restore persistent daemon to runtime-on and writes-off\n        id: restore_daemon\n        if:',
    1,
)
src = src.replace(
    '          PROVIDER_WRITE_OUTCOME: ${{ steps.provider_write.outcome }}\n',
    '          PROVIDER_WRITE_OUTCOME: ${{ steps.provider_write.outcome }}\n          RESERVATION_CLEANUP_OUTCOME: ${{ steps.reservation_cleanup.outcome }}\n          RESTORE_OUTCOME: ${{ steps.restore_daemon.outcome }}\n',
    1,
)
old = '''          if [[ "${{ job.status }}" == success && "$POST_OUTCOME" == success && "$PROVIDER_WRITE_OUTCOME" == success ]]; then
            STATUS=PASS
            SENT=1
            ACK=true
          else
            STATUS=FAIL
            SENT=0
            ACK=false
          fi
'''
new = '''          STATUS=FAIL
          if [[ "$POST_OUTCOME" == success ]]; then
            SENT=1
            ACK=true
          elif [[ "$PROVIDER_WRITE_OUTCOME" == skipped ]]; then
            SENT=0
            ACK=false
          else
            SENT=UNKNOWN
            ACK=UNKNOWN
          fi
          if [[ "${{ job.status }}" == success && "$POST_OUTCOME" == success && "$PROVIDER_WRITE_OUTCOME" == success && "$RESERVATION_CLEANUP_OUTCOME" == success && "$RESTORE_OUTCOME" == success ]]; then
            STATUS=PASS
          fi
          if [[ "$RESERVATION_CLEANUP_OUTCOME" == success ]]; then CLEANUP=true; else CLEANUP=false; fi
          if [[ "$RESTORE_OUTCOME" == success ]]; then RESTORED=true; else RESTORED=false; fi
'''
if old not in src:
    raise SystemExit('expected evidence status block missing')
src = src.replace(old, new, 1)
old_evidence = "            'DAEMON_ENGAGEMENT_RUNTIME_RESTORED=true' \\\n            'DAEMON_ENGAGEMENT_WRITES=false' \\\n"
new_evidence = "            \"CANARY_RESERVATIONS_CLEANED=$CLEANUP\" \\\n            \"DAEMON_ENGAGEMENT_RUNTIME_RESTORED=$RESTORED\" \\\n            'DAEMON_ENGAGEMENT_WRITES=false' \\\n"
if old_evidence not in src:
    raise SystemExit('expected restore evidence block missing')
src = src.replace(old_evidence, new_evidence, 1)
out = Path('.canary-v2-output/instagram-engagement-controlled-write-canary-v2.yml')
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(src)
