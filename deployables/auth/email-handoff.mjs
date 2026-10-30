export function createEmailHandoff({ portalInternalURL, serviceSecret, isCurrent, fetchImpl = fetch }) {
  const pending = [];
  let active = false;
  let closed = false;
  const maxPending = 64;

  async function drain() {
    if (active || closed) return;
    active = true;
    try {
      while (pending.length && !closed) {
        const message = pending.shift();
        try {
          if (!(await isCurrent(message))) continue;
          await fetchImpl(`${portalInternalURL.replace(/\/$/u, "")}/internal/email/login`, {
            method: "POST",
            headers: {
              authorization: `Bearer ${serviceSecret}`,
              "content-type": "application/json",
            },
            body: JSON.stringify(message),
            signal: AbortSignal.timeout(3000),
          });
        } catch {
          // The bounded handoff is best-effort. Never log its email or credential URL.
        }
      }
    } finally {
      active = false;
      if (pending.length && !closed) void drain();
    }
  }

  return {
    enqueue(message) {
      if (closed || pending.length >= maxPending) return false;
      pending.push(message);
      void drain();
      return true;
    },
    close() {
      closed = true;
      pending.length = 0;
    },
    pendingCount() {
      return pending.length;
    },
  };
}
