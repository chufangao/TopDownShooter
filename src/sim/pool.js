// A pool of worker threads over one module (`url`, the caller's own import.meta.url, started with `workerData`): each
// worker takes jobs off the shared queue until it is empty, posting each job and awaiting its reply. `onDone(i, result,
// ms)` is called for each job in the order they finish, `i` its index in `jobs`. Nothing runs with `workers` at 0.
export async function pool (url, workerData, jobs, workers, onDone) {
  const { Worker } = await import('node:worker_threads')
  const queue = jobs.map((job, i) => [i, job])
  const one = async () => {
    const w = new Worker(new URL(url), { workerData })
    try {
      while (queue.length) {
        const [i, job] = queue.shift()
        const t0 = Date.now()
        const out = await new Promise((resolve, reject) => {
          const off = () => { w.off('message', ok); w.off('error', fail); w.off('exit', exit) }
          const ok = (msg) => { off(); resolve(msg) }
          const fail = (err) => { off(); reject(err) }
          const exit = (code) => { off(); reject(new Error(`worker exited with ${code}`)) }
          w.on('message', ok)
          w.on('error', fail)
          w.on('exit', exit)
          w.postMessage(job)
        })
        await onDone(i, out, Date.now() - t0)
      }
    } finally {
      await w.terminate()
    }
  }
  await Promise.all(Array.from({ length: Math.max(0, Math.min(workers, jobs.length)) }, one))
}
