import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSetCookie } from '../src/index';

test('parseSetCookie keeps the comma inside Expires', () => {
  const cookie = parseSetCookie('session=abc123; Expires=Wed, 21 Oct 2026 07:28:00 GMT; Path=/');
  assert.ok(cookie);
  assert.equal(cookie.name, 'session');
  assert.equal(cookie.value, 'abc123');
  assert.equal(cookie.expires?.toISOString(), '2026-10-21T07:28:00.000Z');
  assert.equal(cookie.path, '/');
});

test('parseSetCookie reads flags and typed attributes', () => {
  const cookie = parseSetCookie(
    'id=1; Max-Age=3600; Domain=.Example.COM; Secure; HttpOnly; SameSite=lax; Partitioned',
  );
  assert.deepEqual(cookie, {
    name: 'id',
    value: '1',
    maxAge: 3600,
    domain: 'example.com',
    sameSite: 'Lax',
    secure: true,
    httpOnly: true,
    partitioned: true,
    extensions: [],
  });
});

test('parseSetCookie treats quotes in the value as literal', () => {
  const cookie = parseSetCookie('q="a;b"; Secure');
  assert.ok(cookie);
  assert.equal(cookie.value, '"a');
  assert.equal(cookie.secure, true);
  assert.deepEqual(cookie.extensions, ['b"']);
});

test('parseSetCookie keeps "=" inside the value', () => {
  assert.equal(parseSetCookie('token=a=b==')?.value, 'a=b==');
});

test('parseSetCookie ignores bad attributes without dropping the cookie', () => {
  const cookie = parseSetCookie('a=b; Max-Age=soon; Expires=never; Path=relative; SameSite=weird');
  assert.deepEqual(cookie, {
    name: 'a',
    value: 'b',
    secure: false,
    httpOnly: false,
    partitioned: false,
    extensions: [],
  });
});

test('parseSetCookie lets the last repeated attribute win', () => {
  assert.equal(parseSetCookie('a=b; Path=/x; Path=/y')?.path, '/y');
  assert.equal(parseSetCookie('a=b; Max-Age=-1')?.maxAge, -1);
});

test('parseSetCookie keeps unknown attributes verbatim', () => {
  assert.deepEqual(parseSetCookie('a=b; Priority=High; Foo')?.extensions, ['Priority=High', 'Foo']);
});

test('parseSetCookie rejects unusable name-value pairs', () => {
  assert.equal(parseSetCookie('novalue; Secure'), null);
  assert.equal(parseSetCookie('=x'), null);
  assert.equal(parseSetCookie(''), null);
});
