import { parentPort } from 'node:worker_threads'
import { measure } from './lib.mjs'
parentPort.on('message', (job) => {
  try {
    parentPort.postMessage({ ...job, res: measure(job.room, job.cfg, job.budget) })
  } catch (err) {
    parentPort.postMessage({ ...job, error: String(err?.stack ?? err) })
  }
})
