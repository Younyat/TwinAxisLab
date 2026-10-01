import type { HistorianRecord } from '../application/twin/historianReplay';

const DB_NAME = 'twinaxis-historian';
const STORE = 'records';
type StoredRecord = { key: string; projectId: string; timestamp: number; sequence: number; record: HistorianRecord };

const openDatabase = () => new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open(DB_NAME, 1);
  request.onupgradeneeded = () => { const store = request.result.createObjectStore(STORE, { keyPath: 'key' }); store.createIndex('project-time', ['projectId', 'timestamp']); };
  request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error ?? new Error('TwinAxis historian database failed to open.'));
});

const transactionDone = (transaction: IDBTransaction) => new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error); });

export class IndexedDbTwinHistorian {
  async append(projectId: string, records: HistorianRecord[]) {
    const database = await openDatabase(); const transaction = database.transaction(STORE, 'readwrite'); const store = transaction.objectStore(STORE);
    records.forEach((record) => { const timestamp = Date.parse(record.sourceTimestampUtc); const stored: StoredRecord = { key: `${projectId}|${timestamp}|${record.sequence}|${record.kind}`, projectId, timestamp, sequence: record.sequence, record }; store.put(stored); });
    await transactionDone(transaction); database.close();
  }
  async query(projectId: string, startUtc: string, endUtc: string) {
    const database = await openDatabase(); const transaction = database.transaction(STORE, 'readonly'); const index = transaction.objectStore(STORE).index('project-time');
    const request = index.getAll(IDBKeyRange.bound([projectId, Date.parse(startUtc)], [projectId, Date.parse(endUtc)]));
    const records = await new Promise<StoredRecord[]>((resolve, reject) => { request.onsuccess = () => resolve(request.result as StoredRecord[]); request.onerror = () => reject(request.error); });
    database.close(); return records.sort((a, b) => a.timestamp - b.timestamp || a.sequence - b.sequence).map((item) => item.record);
  }
  async clear(projectId: string) {
    const records = await this.query(projectId, new Date(0).toISOString(), new Date(8640000000000000).toISOString()); const database = await openDatabase(); const transaction = database.transaction(STORE, 'readwrite'); const store = transaction.objectStore(STORE);
    records.forEach((record) => store.delete(`${projectId}|${Date.parse(record.sourceTimestampUtc)}|${record.sequence}|${record.kind}`)); await transactionDone(transaction); database.close();
  }
}
