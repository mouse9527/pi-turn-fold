#!/usr/bin/env python3
"""Real bundled Pi + isolated PTY; synthetic history only, no model/network request.
Usage: python3 tests/smoke.py [/path/to/pi/dist/bundle/cli.js]
This checks terminal text, not Ghostty's image pixels or input-to-paint latency.
"""
import fcntl
import json
import os
from pathlib import Path
import pty
import re
import select
import struct
import subprocess
import sys
import tempfile
import termios
import time

ROOT = Path(__file__).resolve().parent.parent
CLI = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js'
ANSI = re.compile(rb'\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07]*(?:\x07|\x1b\\)')

with tempfile.TemporaryDirectory(prefix='pi-turn-fold-smoke-') as directory:
    home = Path(directory)
    (home / 'fixtures').mkdir()
    session = home / 'fixtures' / 'synthetic.jsonl'
    rows = [dict(type='session', version=3, id='00000000-0000-4000-8000-000000000001', timestamp='2026-01-01T00:00:00.000Z', cwd=str(home))]
    parent = None
    def append(message):
        global parent
        entry_id = f'{len(rows):08x}'
        rows.append(dict(type='message', id=entry_id, parentId=parent, timestamp='2026-01-01T00:00:00.000Z', message=message))
        parent = entry_id
    usage = dict(input=1, output=1, cacheRead=0, cacheWrite=0, totalTokens=2,
                 cost=dict(input=0, output=0, cacheRead=0, cacheWrite=0, total=0))
    def assistant(content, stop='stop'):
        return dict(role='assistant', content=content, stopReason=stop, timestamp=0,
                    api='anthropic-messages', provider='test', model='synthetic', usage=usage)
    append(dict(role='user', content='Synthetic folding test', timestamp=0))
    for index in range(300):
        if index == 150:
            append(assistant([dict(type='text', text='SYNTHETIC-MIDDLE-MESSAGE')]))
        append(assistant([dict(type='thinking', thinking='Hidden reasoning'),
            dict(type='toolCall', id=f'call-{index}', name='bash', arguments=dict(command='echo PRIVATE-LONG-SCRIPT\n' + 'echo x\n' * 20))], 'toolUse'))
        content = [dict(type='text', text='SAVED-TOOL-OUTPUT\n' * 80)]
        if index % 100 == 0:
            content.append(dict(type='image', mimeType='image/png', data='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1sAAAAASUVORK5CYII='))
        append(dict(role='toolResult', toolCallId=f'call-{index}', toolName='bash', content=content, isError=False, timestamp=0))
    append(assistant([dict(type='text', text='SYNTHETIC-FINAL-ANSWER')]))
    session.write_text('\n'.join(json.dumps(row) for row in rows) + '\n')
    # Check the fixture independently before exercising the bundled loader.
    fixture_check = subprocess.run(['node', '--input-type=module', '-e',
        'import {SessionManager} from "@earendil-works/pi-coding-agent"; const s=SessionManager.open(process.argv[1]); console.log(s.buildContextEntries().length)', str(session)],
        cwd=ROOT, capture_output=True, text=True, check=True)
    assert int(fixture_check.stdout.strip()) == 603, fixture_check.stdout
    (home / 'settings.json').write_text(json.dumps(dict(enableInstallTelemetry=False, showCacheMissNotices=False)))
    master, slave = pty.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 40, 120, 0, 0))
    env = {**os.environ, 'PI_CODING_AGENT_DIR': str(home), 'PI_OFFLINE': '1', 'PI_TELEMETRY': '0', 'TERM': 'xterm-256color'}
    process = subprocess.Popen(['node', str(CLI), '--offline', '--no-extensions', '-e', str(ROOT / 'extensions/index.ts'),
        '--no-skills', '--no-context-files', '--no-prompt-templates', '--no-themes',
        '--tui-mode', 'fullscreen' if os.environ.get('FOLD_SMOKE_FULLSCREEN') else 'regular', '--session', str(session)],
        stdin=slave, stdout=slave, stderr=slave, cwd=home, env=env, start_new_session=True)
    os.close(slave)
    output = bytearray()
    def until(needle, seconds=20):
        deadline = time.monotonic() + seconds
        start = len(output)
        while time.monotonic() < deadline:
            if select.select([master], [], [], 0.1)[0]:
                try:
                    data = os.read(master, 65536)
                except OSError:
                    break
                if not data:
                    break
                output.extend(data)
                # Answer only terminal queries, never a model prompt.
                if b'\x1b[6n' in data: os.write(master, b'\x1b[1;1R')
                if needle.encode() in ANSI.sub(b'', bytes(output[start:])):
                    return ANSI.sub(b'', bytes(output[start:])).decode(errors='replace')
            if process.poll() is not None:
                break
        raise AssertionError(f'Missing {needle!r}; terminal tail:\n' + ANSI.sub(b'', bytes(output[-16000:])).decode(errors='replace'))
    def command(text):
        os.write(master, text.encode() + b'\r')
    try:
        initial = until('SYNTHETIC-FINAL-ANSWER')
        assert 'PRIVATE-LONG-SCRIPT' not in initial
        assert 'SAVED-TOOL-OUTPUT' not in initial
        assert '已完成 · 执行 150' in initial
        assert 'SYNTHETIC-MIDDLE-MESSAGE' in initial
        middle = initial.index('SYNTHETIC-MIDDLE-MESSAGE')
        assert '已完成 · 执行 150' in initial[:middle] and '已完成 · 执行 150' in initial[middle:]
        # Native message-block spacing, measured from emitted rows rather than concatenated text.
        if os.environ.get('FOLD_SMOKE_FULLSCREEN'):
            # Pi fullscreen paints absolute row positions followed by erase-line. This is not
            # a general terminal emulator; only inspect those real initial-frame row writes.
            paints = re.finditer(rb'\x1b\[(\d+);1H\x1b\[2K(.*?)(?=\x1b\[\d+;\d+H|$)', bytes(output), re.S)
            screen = {int(match[1]): ANSI.sub(b'', match[2]).decode(errors='replace').strip() for match in paints}
            text_row = next(row for row, value in screen.items() if 'SYNTHETIC-MIDDLE-MESSAGE' in value)
            group_row = min(row for row, value in screen.items() if row > text_row and '已完成 · 执行 150' in value)
            assert group_row == text_row + 2 and screen[text_row + 1] == '', screen
        else:
            emitted = initial.replace('\r', '').split('\n')
            text_row = next(row for row, value in enumerate(emitted) if 'SYNTHETIC-MIDDLE-MESSAGE' in value)
            assert emitted[text_row + 1].strip() == '', emitted[text_row:text_row + 4]
            assert '已完成 · 执行 150' in emitted[text_row + 2], emitted[text_row:text_row + 4]
        command('/fold 1')
        until('✓ 执行 echo PRIVATE-LONG-SCRIPT')
        command('/fold 1 300')
        until('SAVED-TOOL-OUTPUT')
        command('/fold off')
        until('Native transcript restored', seconds=30)
        command('/fold on')
        enabled = until('Folding enabled.', seconds=30)
        assert '已完成 · 执行 150' in enabled and 'SYNTHETIC-MIDDLE-MESSAGE' in enabled
        command('/reload')
        reloaded = until('Reloaded keybindings', seconds=30)
        assert '已完成 · 执行 150' in reloaded and 'SYNTHETIC-MIDDLE-MESSAGE' in reloaded
        command('/quit')
        deadline = time.monotonic() + 10
        while process.poll() is None and time.monotonic() < deadline:
            if select.select([master], [], [], 0.1)[0]:
                try:
                    output.extend(os.read(master, 65536))
                except OSError:
                    break
        process.wait(timeout=3)
        assert process.returncode == 0, process.returncode
        print('PASS: bundled host identity, segmented restore with native message spacing, two-level command expansion, off/on without reload, reload, quit (300 synthetic calls).')
    finally:
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=3)
        os.close(master)
