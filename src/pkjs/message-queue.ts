interface QueuedMessage {
  data: Record<string, any>;
  ackCallback: (e: PebbleKit.AppMessageEvent) => void;
  nackCallback: (e: PebbleKit.AppMessageEvent) => void;
}

class MessageQueue {
  private queue: QueuedMessage[] = [];
  private sending = false;
  private sendTimer: ReturnType<typeof setTimeout> | undefined;
  private static SEND_TIMEOUT_MS = 4000;

  enqueue(
    data: Record<string, any>,
    ackCallback: (e: PebbleKit.AppMessageEvent) => void = () => {},
    nackCallback: (e: PebbleKit.AppMessageEvent) => void = (e) =>
      console.error('Send failed:', e.error),
  ): void {
    this.queue.push({ data, ackCallback, nackCallback });
    this.processQueue();
  }

  private processQueue(): void {
    if (this.sending || this.queue.length === 0) {
      return;
    }

    const message = this.queue.shift()!;
    this.sending = true;

    console.info('Sending message', Object.keys(message.data));

    this.sendTimer = setTimeout(() => {
      if (this.sending) {
        console.error('Message send timeout, unblocking queue');
        message.nackCallback({ error: { message: 'timeout' } } as any);
        this.sending = false;
        this.processQueue();
      }
    }, MessageQueue.SEND_TIMEOUT_MS);

    try {
      Pebble.sendAppMessage(
        message.data,
        (e) => {
          clearTimeout(this.sendTimer);
          this.sendTimer = undefined;
          message.ackCallback(e);
          this.sending = false;
          this.processQueue();
        },
        (e) => {
          clearTimeout(this.sendTimer);
          this.sendTimer = undefined;
          message.nackCallback(e);
          this.sending = false;
          this.processQueue();
        },
      );
    } catch (e) {
      clearTimeout(this.sendTimer);
      this.sendTimer = undefined;
      this.sending = false;
      message.nackCallback({ data: {}, error: { message: 'sendAppMessage threw: ' + e } } as any);
      this.processQueue();
    }
  }

  clear(): void {
    this.queue = [];
    if (this.sendTimer !== undefined) {
      clearTimeout(this.sendTimer);
      this.sendTimer = undefined;
    }
  }

  get length(): number {
    return this.queue.length;
  }
}

export const messageQueue = new MessageQueue();
