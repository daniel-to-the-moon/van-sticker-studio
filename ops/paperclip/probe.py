#!/usr/bin/env python3
"""Read-only loopback smoke check; never logs response bodies or credentials."""

import argparse
import hashlib
import json
import sys
import urllib.error
import urllib.request


def inspect(path, port):
    request = urllib.request.Request('http://127.0.0.1:' + str(port) + path)
    try:
        response = urllib.request.urlopen(request, timeout=10)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        body = response.read(2 * 1024 * 1024)
        return {
            'path': path,
            'status': response.code,
            'content_type': response.headers.get('Content-Type', ''),
            'bytes': len(body),
            'sha256': hashlib.sha256(body).hexdigest(),
        }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=3100)
    port = parser.parse_args().port
    if not 1 <= port <= 65535:
        parser.error('port must be between 1 and 65535')
    results = [inspect(path, port) for path in ('/api/health', '/', '/api/companies')]
    print(json.dumps({'checks': results}, indent=2))
    health, ui, protected = results
    if health['status'] != 200 or ui['status'] != 200:
        return 1
    if protected['status'] not in (401, 403):
        print('Protected API did not reject anonymous access.', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (OSError, urllib.error.URLError) as error:
        print(type(error).__name__ + ': local service check failed', file=sys.stderr)
        sys.exit(1)
