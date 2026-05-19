self.addEventListener('push', (event) => {
  let payload = {};
  if (event.data) {
    try {
      payload = event.data.json();
    } catch {
      payload = { title: 'Remote Agent Console', body: event.data.text() };
    }
  }

  const title =
    payload.event === 'task.approval_requested'
      ? 'Approval required'
      : payload.event === 'task.completed'
        ? 'Task completed'
        : payload.event === 'task.failed'
          ? 'Task failed'
          : 'Remote Agent Console';
  const body = payload.title || payload.body || 'Task update';

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      data: {
        url: payload.taskId ? `/tasks/${payload.taskId}` : '/',
      },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          client.focus();
          return;
        }
      }

      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }

      return undefined;
    }),
  );
});
