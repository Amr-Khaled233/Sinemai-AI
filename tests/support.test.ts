import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isUnreadFor } from '../src/lib/support';

const at = (minute: number) => new Date(Date.UTC(2026, 8, 26, 12, minute));
const thread = (over: Partial<Parameters<typeof isUnreadFor>[0]> = {}) => ({
  userReadAt: null,
  adminReadAt: null,
  messages: [],
  ...over,
});

describe('support unread', () => {
  it('a new user message is unread for the admin, not for the user', () => {
    const t = thread({ userReadAt: at(0), messages: [{ fromAdmin: false, createdAt: at(0) }] });
    assert.equal(isUnreadFor(t, true), true);
    assert.equal(isUnreadFor(t, false), false);
  });

  it('an admin reply is unread for the user until they open it', () => {
    const t = thread({ userReadAt: at(0), adminReadAt: at(5), messages: [{ fromAdmin: true, createdAt: at(5) }] });
    assert.equal(isUnreadFor(t, false), true);
    assert.equal(isUnreadFor({ ...t, userReadAt: at(6) }, false), false);
    assert.equal(isUnreadFor(t, true), false);
  });

  it('your own latest message never counts as unread', () => {
    const t = thread({ messages: [{ fromAdmin: true, createdAt: at(9) }] });
    assert.equal(isUnreadFor(t, true), false);
  });

  it('an empty thread is not unread', () => {
    assert.equal(isUnreadFor(thread(), true), false);
  });
});
