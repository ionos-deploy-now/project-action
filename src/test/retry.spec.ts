import { describe } from 'mocha';
import Retryable from '../main/action/api/retry';
import { expect } from 'chai';

describe('Test retry method', () => {
  it('Use no retries', async () => {
    let count = 0;

    const usedRetries = await new Retryable<number>(
      async (retry, lastRetry) =>
        await new Promise((resolve) => resolve(true)).then((value) => {
          if (value) {
            return count;
          } else if (lastRetry) {
            return -1;
          } else {
            count++;
            return retry();
          }
        }),
      { count: 5 }
    ).run();

    expect(usedRetries).to.equal(0);
  });

  it('Use multiple retries', async () => {
    const values = [true, false, false];
    let count = 0;

    const usedRetries = await new Retryable<number>(
      async (retry, lastRetry) =>
        await new Promise((resolve) => resolve(values.pop())).then((value) => {
          if (value) {
            return count;
          } else if (lastRetry) {
            return -1;
          } else {
            count++;
            return retry();
          }
        }),
      { count: 5 }
    ).run();

    expect(usedRetries).to.equal(2);
  });

  it('Use max retries', async () => {
    const values = [true, false, false, false, false, false];
    let count = 0;

    const usedRetries = await new Retryable<number>(
      async (retry, lastRetry) =>
        await new Promise((resolve) => resolve(values.pop())).then((value) => {
          if (value) {
            return count;
          } else if (lastRetry) {
            return -1;
          } else {
            count++;
            return retry();
          }
        }),
      { count: 5 }
    ).run();

    expect(usedRetries).to.equal(5);
  });

  it('Abort after max retries', async () => {
    let count = 0;

    const usedRetries = await new Retryable<number>(
      async (retry, lastRetry) =>
        await new Promise((resolve) => resolve(false)).then((value) => {
          if (value) {
            return count;
          } else if (lastRetry) {
            return -1;
          } else {
            count++;
            return retry();
          }
        }),
      { count: 5 }
    ).run();

    expect(usedRetries).to.equal(-1);
  });
});
