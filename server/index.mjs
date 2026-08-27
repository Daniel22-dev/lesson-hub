import { createLessonHubServer } from './app.mjs';
import { loadServerConfig } from './lib/config.mjs';
import { startOperationsScheduler } from './lib/operations.mjs';

const config = loadServerConfig();
const { server, store, dispatcher, mailAdapter, operations } = await createLessonHubServer({ config });
store.onWriteFailure = (error, count) => {
  console.error(`Zápis serverových dat selhal (${count}x po sobě):`, error);
  if (count >= 3) {
    console.error('Server se ukončuje, protože nemůže spolehlivě ukládat data.');
    setImmediate(() => process.exit(1));
  }
};
server.listen(config.port, config.host, () => {
  console.log(`Lesson Hub Server 1.2.11 běží na http://${config.host}:${config.port}`);
  console.log(`Datový soubor: ${config.dataFile}`);
  console.log(`E-mailová brána: ${mailAdapter.status.mode}${mailAdapter.status.configured ? ' · připravena' : ' · nenakonfigurována'}`);
  if (!config.backupEnabled) console.warn('VAROVÁNÍ: Automatické serverové snapshoty jsou vypnuté.');
});

if (config.mailSchedulerEnabled) {
  const timer = setInterval(() => {
    dispatcher.processDue({ actorId: 'server-scheduler' }).catch((error) => console.error('Plánovač zpráv selhal:', error));
  }, config.mailSchedulerIntervalMs);
  timer.unref();
}

startOperationsScheduler({ operations, intervalMs: config.operationsIntervalMs, onError: (...args) => console.error(...args) });
