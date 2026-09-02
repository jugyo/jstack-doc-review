# Queue processing design

Requests are accepted by the API and written to a durable queue.

## Consumer

The consumer processes events asynchronously so the request path remains responsive.

- Failed events are retried three times.
- Completed events are retained for seven days.

> This document is a browser conversation fixture.
