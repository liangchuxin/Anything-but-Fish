import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { completeChapter, getChapterProgress, getEntryPage, saveChapterProgress } from "../src/lib/chapter-api.js";

const chapterId = "ancient-gold-coin";
const progress = { chapterId, entryId: 1002, furthestEntryId: 1003, completedAt: null };
afterEach(() => mock.restoreAll());

test("chapter reads and writes use authenticated requests with stable entry IDs", async () => {
  const signal = new AbortController().signal;
  const calls = [];
  mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url, options });
    assert.equal(options.credentials, "include");
    assert.equal(options.cache, "no-store");
    assert.equal(options.signal, signal);
    return Response.json(url.endsWith("/complete")
      ? { progress: { ...progress, completedAt: "2026-11-21T12:00:00Z" }, awardedItems: [{ itemId: "ancient-coin", count: 1 }], alreadyCompleted: false }
      : progress);
  });
  assert.deepEqual(await getChapterProgress(chapterId, { signal }), progress);
  assert.deepEqual(await saveChapterProgress(chapterId, 1002, { signal }), progress);
  const completed = await completeChapter(chapterId, { signal });
  assert.equal(completed.awardedItems[0].count, 1);
  assert.deepEqual(calls.map(({ url, options }) => [url, options.method, options.body]), [
    [`/api/game/chapters/${chapterId}/progress`, "GET", undefined],
    [`/api/game/chapters/${chapterId}/progress`, "POST", '{"entryId":1002}'],
    [`/api/game/chapters/${chapterId}/complete`, "POST", "{}"],
  ]);
});

test("empty progress is valid and page numbers are resolved from current order", async () => {
  const empty = { chapterId, entryId: null, furthestEntryId: null, completedAt: null };
  mock.method(globalThis, "fetch", async () => Response.json(empty));
  assert.deepEqual(await getChapterProgress(chapterId), empty);
  const entries = [{ id: 1001 }, { id: 1048 }, { id: 1002 }];
  assert.equal(getEntryPage(entries, 1002), 3);
  assert.equal(getEntryPage(entries, null), 1);
  assert.equal(getEntryPage(entries, 9999), null);
});

test("malformed chapter responses and invalid entry IDs are rejected", async () => {
  mock.method(globalThis, "fetch", async () => new Response("<html>Fallback</html>"));
  await assert.rejects(getChapterProgress(chapterId), /invalid chapter progress/);
  for (const response of [
    { ...progress, chapterId: "other" },
    { ...progress, entryId: "1002" },
    { ...progress, furthestEntryId: 1.5 },
    { ...progress, completedAt: "invalid" },
  ]) {
    globalThis.fetch.mock.mockImplementation(async () => Response.json(response));
    await assert.rejects(getChapterProgress(chapterId), /invalid chapter progress/);
  }
  globalThis.fetch.mock.mockImplementation(async () => Response.json({ progress, awardedItems: [{ itemId: "ancient-coin", count: -1 }], alreadyCompleted: false }));
  await assert.rejects(completeChapter(chapterId), /invalid chapter progress/);
  await assert.rejects(saveChapterProgress(chapterId, "1002"), /valid story entry/);
  await assert.rejects(getChapterProgress("../auth"), /valid chapter/);
});

test("progress failures preserve conflict and authentication status for retry UI", async () => {
  mock.method(globalThis, "fetch", async () => Response.json({ detail: "Read the preceding entry first." }, { status: 409 }));
  await assert.rejects(saveChapterProgress(chapterId, 1047), (error) => error.status === 409 && /preceding entry/.test(error.message));
  globalThis.fetch.mock.mockImplementation(async () => Response.json({}, { status: 401 }));
  await assert.rejects(completeChapter(chapterId), (error) => error.status === 401 && /log in/.test(error.message));
  const abort = new DOMException("Aborted", "AbortError");
  globalThis.fetch.mock.mockImplementation(async () => { throw abort; });
  await assert.rejects(getChapterProgress(chapterId), (error) => error === abort);
});
