type TimerHandle = ReturnType<typeof setTimeout>;

export interface MqpetStartupWebContents {
  isLoadingMainFrame(): boolean;
  once(event: 'did-finish-load', cb: () => void): void;
}

export interface MqpetStartupWindow {
  webContents: MqpetStartupWebContents;
}

export interface ScheduleMqpetStartupOptions {
  enabled: boolean;
  mainWindow: MqpetStartupWindow | null;
  create: () => void;
  setTimeout?: (cb: () => void, ms: number) => TimerHandle | number;
  requestIdleCallback?: ((cb: () => void) => unknown) | undefined;
  delayMs?: number;
}

export function scheduleMqpetStartup({
  enabled,
  mainWindow,
  create,
  setTimeout: scheduleTimeout = setTimeout,
  requestIdleCallback,
  delayMs = 1500,
}: ScheduleMqpetStartupOptions): void {
  if (!enabled || !mainWindow) return;

  let created = false;
  const createOnce = (): void => {
    if (created) return;
    created = true;
    create();
  };

  const afterDelay = (): void => {
    scheduleTimeout(() => {
      if (requestIdleCallback) {
        requestIdleCallback(createOnce);
      } else {
        createOnce();
      }
    }, delayMs);
  };

  if (mainWindow.webContents.isLoadingMainFrame()) {
    mainWindow.webContents.once('did-finish-load', afterDelay);
  } else {
    afterDelay();
  }
}
