class EventBus {
  constructor() {
    this.target = new EventTarget();
  }

  on(eventName, callback) {
    const handler = (event) => callback(event.detail);
    this.target.addEventListener(eventName, handler);
    return () => this.target.removeEventListener(eventName, handler);
  }

  emit(eventName, detail = undefined) {
    this.target.dispatchEvent(new CustomEvent(eventName, { detail }));
  }
}

export const eventBus = new EventBus();
