import { SerialQueue } from './serial-queue.js';

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('SerialQueue', () => {
  it("runs one key's tasks in order, one at a time", async () => {
    const queue = new SerialQueue(() => {});
    const log: string[] = [];
    const task = (name: string, ms: number) => async () => {
      log.push(`${name} start`);
      await tick(ms);
      log.push(`${name} end`);
    };

    void queue.run('customer', task('first', 20));
    void queue.run('customer', task('second', 1));
    await queue.idle();

    expect(log).toEqual([
      'first start',
      'first end',
      'second start',
      'second end',
    ]);
  });

  it('runs different keys in parallel', async () => {
    const queue = new SerialQueue(() => {});
    const log: string[] = [];

    void queue.run('a', async () => {
      log.push('a start');
      await tick(20);
      log.push('a end');
    });
    void queue.run('b', async () => {
      log.push('b start');
      await tick(1);
      log.push('b end');
    });
    await queue.idle();

    expect(log).toEqual(['a start', 'b start', 'b end', 'a end']);
  });

  it('reports a failed task and keeps going', async () => {
    const errors: unknown[] = [];
    const queue = new SerialQueue((_key, error) => errors.push(error));
    let ran = false;

    void queue.run('customer', () => Promise.reject(new Error('boom')));
    void queue.run('customer', () => {
      ran = true;
      return Promise.resolve();
    });
    await queue.idle();

    expect(errors).toEqual([new Error('boom')]);
    expect(ran).toBe(true);
  });

  it('waits for tasks queued while idle() is waiting', async () => {
    const queue = new SerialQueue(() => {});
    let done = 0;

    void queue.run('a', async () => {
      await tick(5);
      void queue.run('b', async () => {
        await tick(5);
        done++;
      });
      done++;
    });
    await queue.idle();

    expect(done).toBe(2);
  });
});
