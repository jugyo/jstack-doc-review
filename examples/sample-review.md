# Event delivery design

This sample document exercises the main **jstack-md** document conversation.

## Background

The API accepts an event and writes it to a durable queue before returning a response.

> The request path should remain fast even when downstream consumers are unavailable.

## Processing model

The consumer processes events asynchronously, uses an idempotency key, and records the outcome for each attempt.

1. Read the next available event.
2. Validate its payload.
3. Deliver it to the configured destination.
4. Mark the event as completed or schedule a retry.

```ts
type DeliveryResult = {
  eventId: string
  status: "completed" | "retrying" | "failed"
}
```

## Open questions

- Should retries use a fixed or exponential delay?
- How long should completed delivery records be retained?
- Which failures require operator notification?

Select any sentence or hover a line to start a conversation. You can also ask a question about the whole document.
